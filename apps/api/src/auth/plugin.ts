import cookie from '@fastify/cookie';
import type { FastifyPluginAsync, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { getEnv } from '../env.js';
import { ApiError } from '../errors.js';
import { ACCESS_COOKIE } from './cookies.js';
import { verifyAccessToken } from './tokens.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
  interface FastifyInstance {
    authenticate: preHandlerAsyncHookHandler;
  }
}

export function isEmailAllowed(email: string): boolean {
  const allowed = getEnv().allowedEmails;
  if (allowed.length === 0) return true;
  const normalised = email.trim().toLowerCase();
  return allowed.some((entry) => entry.trim().toLowerCase() === normalised);
}

export function assertEmailAllowed(email: string): void {
  if (!isEmailAllowed(email)) {
    throw new ApiError(
      'permission-denied',
      'This account is not allowed to use Video Studio. Ask an administrator for access.',
    );
  }
}

/** Every authenticated route needs the caller, so make the optional field explicit once. */
export function requireAuthUser(request: FastifyRequest): AuthUser {
  const user = request.authUser;
  if (!user) {
    throw new ApiError('unauthenticated', 'Authentication required.');
  }
  return user;
}

const authPluginImpl: FastifyPluginAsync = async (fastify) => {
  // Cookies are this plugin's transport; register them here unless the server
  // already did, so authPlugin works standalone in tests.
  if (!fastify.hasReplyDecorator('setCookie')) {
    await fastify.register(cookie);
  }

  const authenticate: preHandlerAsyncHookHandler = async (request) => {
    const token = request.cookies[ACCESS_COOKIE];
    if (!token) {
      throw new ApiError('unauthenticated', 'Authentication required.');
    }

    const claims = await verifyAccessToken(token);
    assertEmailAllowed(claims.email);

    request.authUser = { id: claims.sub, email: claims.email, name: claims.name };
  };

  fastify.decorate('authenticate', authenticate);
};

export const authPlugin = fp(authPluginImpl, { name: 'video-studio-auth' });
