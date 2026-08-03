import type { UserDto } from '@video-studio/shared';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { HydratedDocument } from 'mongoose';
import { toUserDto } from '../db/mappers.js';
import { SessionModel } from '../db/models/session.js';
import { type UserDoc, UserModel } from '../db/models/user.js';
import { getEnv } from '../env.js';
import { ApiError } from '../errors.js';
import { logger } from '../logger.js';
import {
  clearOauthCookies,
  clearSessionCookies,
  cookieOptions,
  OAUTH_STATE_COOKIE,
  OAUTH_TTL_SECONDS,
  OAUTH_VERIFIER_COOKIE,
  REFRESH_COOKIE,
  REFRESH_TTL_SECONDS,
  setSessionCookies,
} from './cookies.js';
import { createAuthorizationUrl, exchangeCode, type GoogleProfile } from './google.js';
import { assertEmailAllowed, isEmailAllowed, requireAuthUser } from './plugin.js';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from './tokens.js';

type UserDocument = HydratedDocument<UserDoc>;

async function issueSession(reply: FastifyReply, user: UserDocument): Promise<UserDto> {
  const dto = toUserDto(user);
  const accessToken = await signAccessToken({ id: dto.id, email: dto.email, name: dto.name });
  const refresh = generateRefreshToken();

  // Only the hash is stored: a database dump must never yield a usable session.
  await SessionModel.create({
    userId: dto.id,
    refreshTokenHash: refresh.hash,
    expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
  });

  setSessionCookies(reply, { accessToken, refreshToken: refresh.token });
  return dto;
}

async function upsertGoogleUser(profile: GoogleProfile): Promise<UserDocument> {
  const existing =
    (await UserModel.findOne({ googleId: profile.googleId })) ??
    (await UserModel.findOne({ email: profile.email }));

  if (existing) {
    existing.googleId = profile.googleId;
    existing.email = profile.email;
    existing.name = profile.name;
    existing.picture = profile.picture;
    await existing.save();
    return existing;
  }

  return await UserModel.create({
    googleId: profile.googleId,
    email: profile.email,
    name: profile.name,
    picture: profile.picture,
  });
}

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  const env = getEnv();

  fastify.get('/google', async (_request, reply) => {
    const { url, state, codeVerifier } = createAuthorizationUrl();
    reply.setCookie(OAUTH_STATE_COOKIE, state, cookieOptions(OAUTH_TTL_SECONDS));
    reply.setCookie(OAUTH_VERIFIER_COOKIE, codeVerifier, cookieOptions(OAUTH_TTL_SECONDS));
    return await reply.redirect(url, 302);
  });

  fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/google/callback',
    async (request, reply) => {
      const { code, state, error: googleError } = request.query;
      const expectedState = request.cookies[OAUTH_STATE_COOKIE];
      const codeVerifier = request.cookies[OAUTH_VERIFIER_COOKIE];
      clearOauthCookies(reply);

      // The browser lands here directly from Google, so a failure must come back as the
      // login page carrying a reason — not as the JSON error envelope the API uses
      // everywhere else. A rejected user seeing raw JSON is a dead end.
      const fail = async (reason: string, detail: string) => {
        logger.warn({ reason, detail }, 'google sign-in rejected');
        return await reply.redirect(`${env.webAppUrl}/login?error=${reason}`, 302);
      };

      // The user pressed "Cancel" on Google's consent screen, or Google refused outright.
      if (googleError) return await fail('cancelled', googleError);

      if (!code || !state || !expectedState || !codeVerifier || state !== expectedState) {
        return await fail('state', 'state or PKCE verifier missing or mismatched');
      }

      let profile: Awaited<ReturnType<typeof exchangeCode>>;
      try {
        profile = await exchangeCode(code, codeVerifier);
      } catch (exchangeError) {
        return await fail(
          'exchange',
          exchangeError instanceof Error ? exchangeError.message : 'code exchange failed',
        );
      }

      if (!isEmailAllowed(profile.email)) {
        return await fail('forbidden', profile.email);
      }

      const user = await upsertGoogleUser(profile);
      await issueSession(reply, user);
      logger.info({ email: profile.email }, 'google sign-in completed');

      return await reply.redirect(env.webAppUrl, 302);
    },
  );

  if (env.nodeEnv !== 'production' && env.authDevLogin) {
    fastify.post<{ Body: { email?: string; name?: string } }>(
      '/dev-login',
      async (request, reply) => {
        // Re-checked per request: registration alone must not be the only barrier.
        const current = getEnv();
        if (current.nodeEnv === 'production' || !current.authDevLogin) {
          throw new ApiError('not-found', 'Not found.');
        }

        const body = request.body;
        const rawEmail = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
        if (rawEmail.length === 0) {
          throw new ApiError('invalid-argument', 'An email is required.');
        }
        assertEmailAllowed(rawEmail);

        const name =
          typeof body?.name === 'string' && body.name.trim().length > 0
            ? body.name.trim()
            : (rawEmail.split('@')[0] ?? rawEmail);

        const user = await upsertGoogleUser({
          googleId: `dev:${rawEmail}`,
          email: rawEmail,
          name,
          picture: null,
        });

        return await issueSession(reply, user);
      },
    );
  }

  fastify.get('/me', { preHandler: fastify.authenticate }, async (request) => {
    const authUser = requireAuthUser(request);
    const user = await UserModel.findById(authUser.id);
    if (!user) {
      throw new ApiError('unauthenticated', 'Session expired or invalid. Please sign in again.');
    }
    return toUserDto(user);
  });

  fastify.post('/refresh', async (request, reply) => {
    const raw = request.cookies[REFRESH_COOKIE];
    if (!raw) {
      clearSessionCookies(reply);
      throw new ApiError('unauthenticated', 'Session expired. Please sign in again.');
    }

    // Delete-then-recreate in one atomic step: a replayed token finds nothing.
    const session = await SessionModel.findOneAndDelete({
      refreshTokenHash: hashRefreshToken(raw),
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      clearSessionCookies(reply);
      throw new ApiError('unauthenticated', 'Session expired. Please sign in again.');
    }

    const user = await UserModel.findById(session.userId);
    if (!user) {
      clearSessionCookies(reply);
      throw new ApiError('unauthenticated', 'Session expired. Please sign in again.');
    }
    assertEmailAllowed(user.email);

    return await issueSession(reply, user);
  });

  fastify.post('/logout', async (request, reply) => {
    const raw = request.cookies[REFRESH_COOKIE];
    if (raw) {
      await SessionModel.deleteOne({ refreshTokenHash: hashRefreshToken(raw) });
    }
    clearSessionCookies(reply);
    return await reply.code(204).send();
  });
};
