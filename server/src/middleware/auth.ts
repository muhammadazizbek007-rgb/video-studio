import type { Request, RequestHandler } from 'express';
import { HttpError } from '../errors.js';
import { verifyIdToken } from '../firebase.js';
import { getRuntimeConfig } from '../runtimeConfig.js';
import { asyncHandler } from './asyncHandler.js';

export interface AuthedRequest extends Request {
  auth?: { uid: string; email?: string; admin?: boolean };
}

const BEARER = 'Bearer ';

export function requireAuth(): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith(BEARER) ? header.slice(BEARER.length).trim() : '';
    if (token === '') {
      throw new HttpError('unauthenticated', 'Sign in is required.');
    }

    // verifyIdToken already classifies the failure — re-flattening it here
    // would relabel a server-side fault as "sign in again".
    const auth = await verifyIdToken(token);

    (req as AuthedRequest).auth = auth;
    next();
  });
}

export function requireAllowedEmail(): RequestHandler {
  return (req, _res, next) => {
    const { allowedEmails } = getRuntimeConfig();
    if (allowedEmails.length === 0) {
      next();
      return;
    }

    // loadConfig() lower-cases the allow-list, so only the claim needs folding.
    const email = (req as AuthedRequest).auth?.email?.trim().toLowerCase();
    if (email === undefined || !allowedEmails.includes(email)) {
      next(new HttpError('permission-denied', 'This account is not allowed to use Video Studio.'));
      return;
    }

    next();
  };
}
