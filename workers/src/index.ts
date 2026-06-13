import type { Env } from './types';
import { HttpsError } from './types';
import { verifyFirebaseToken } from './firebase-jwt';
import { getAccessToken } from './google-auth';
import { Firestore } from './firestore';
import { handleGenerateMcpToken, handleGetMcpToken } from './handlers/mcp';
import { handleGetClaudeSettings, handleSaveClaudeSettings, handleTestClaudeConnection } from './handlers/claude';
import { handleGetUserCredits, handleGrantCredits, handleRedeemPromoCode } from './handlers/credits';
import { handleStartVideoGeneration, handleTestSeedanceConnection, handleTestProviderConnection } from './handlers/video';
import { handleSetAdminClaim } from './handlers/admin';
import { handleMcp } from './mcp';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errJson(code: string, message: string, status = 400) {
  return json({ error: { status: code, message } }, status);
}

const ERROR_STATUS: Record<string, number> = {
  unauthenticated: 401, 'permission-denied': 403, 'not-found': 404,
  'already-exists': 409, 'resource-exhausted': 429, 'invalid-argument': 400,
  'failed-precondition': 400, internal: 500,
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    const pathParts = url.pathname.replace(/^\/+/, '').split('/');

    // MCP server routes
    if (pathParts[0] === 'mcp') {
      try {
        const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON.replace(/^﻿/, ''));
        const token = await getAccessToken(sa);
        const db = new Firestore(env.FIREBASE_PROJECT_ID, token);
        return handleMcp(request, db, env, ctx);
      } catch (e) {
        return new Response('Server error', { status: 500 });
      }
    }

    if (request.method !== 'POST') return errJson('method-not-allowed', 'Only POST is allowed', 405);

    const functionName = pathParts[0];
    if (!functionName) return errJson('not-found', 'Function name required', 404);

    let body: { data?: unknown };
    try {
      body = await request.json() as { data?: unknown };
    } catch {
      return errJson('invalid-argument', 'Invalid JSON body');
    }

    // Verify Firebase auth
    const authHeader = request.headers.get('Authorization');
    let auth: { uid: string; email?: string; admin?: boolean } | null = null;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        auth = await verifyFirebaseToken(authHeader.slice(7), env.FIREBASE_PROJECT_ID);
      } catch {
        return errJson('unauthenticated', 'Invalid auth token', 401);
      }
    }

    // Build Firestore client
    let db: Firestore;
    try {
      const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON.replace(/^﻿/, ''));
      const token = await getAccessToken(sa);
      db = new Firestore(env.FIREBASE_PROJECT_ID, token);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('Service account error:', msg);
      return errJson('internal', `Server configuration error: ${msg}`, 500);
    }

    const handlerCtx = { auth, db, env, ctx };
    const data = body.data ?? {};

    try {
      let result: unknown;
      switch (functionName) {
        case 'generateMcpToken': result = await handleGenerateMcpToken(handlerCtx, data); break;
        case 'getMcpToken': result = await handleGetMcpToken(handlerCtx, data); break;
        case 'getClaudeSettings': result = await handleGetClaudeSettings(handlerCtx, data); break;
        case 'saveClaudeSettings': result = await handleSaveClaudeSettings(handlerCtx, data); break;
        case 'testClaudeConnection': result = await handleTestClaudeConnection(handlerCtx, data); break;
        case 'getUserCredits': result = await handleGetUserCredits(handlerCtx, data); break;
        case 'grantCredits': result = await handleGrantCredits(handlerCtx, data); break;
        case 'redeemPromoCode': result = await handleRedeemPromoCode(handlerCtx, data); break;
        case 'startVideoGeneration': result = await handleStartVideoGeneration(handlerCtx, data); break;
        case 'setAdminClaim': result = await handleSetAdminClaim(handlerCtx, data); break;
        case 'testSeedanceConnection': result = await handleTestSeedanceConnection(handlerCtx, data); break;
        case 'testProviderConnection': result = await handleTestProviderConnection(handlerCtx, data); break;
        default: return errJson('not-found', `Unknown function: ${functionName}`, 404);
      }
      return json({ result });
    } catch (e) {
      if (e instanceof HttpsError) {
        return errJson(e.code, e.message, ERROR_STATUS[e.code] || 400);
      }
      console.error('Unhandled error in', functionName, e);
      return errJson('internal', e instanceof Error ? e.message : 'Internal error', 500);
    }
  },
};
