import { HttpsError, type HandlerContext } from '../types';

function ensureAuth(ctx: HandlerContext) {
  if (!ctx.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in is required.');
  return ctx.auth.uid;
}

function ensureAllowedEmail(ctx: HandlerContext) {
  const allowed = (ctx.env.VIDEO_STUDIO_ALLOWED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (allowed.length === 0) return;
  const email = (ctx.auth?.email || '').toLowerCase();
  if (!email || !allowed.includes(email)) throw new HttpsError('permission-denied', 'This email is not allowed to access Video Studio.');
}

export async function handleGenerateMcpToken(ctx: HandlerContext, _data: unknown) {
  const userId = ensureAuth(ctx);
  ensureAllowedEmail(ctx);

  const oldTokens = await ctx.db.query('mcpTokens', [{ field: 'userId', op: 'EQUAL', value: userId }]);
  for (const t of oldTokens) await ctx.db.delete('mcpTokens', t.id);

  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, '0')).join('');

  await ctx.db.setWithServerTimestamp('mcpTokens', token, { userId }, ['createdAt']);

  const mcpUrl = `https://video-studio-api.gpmarket007.workers.dev/mcp?token=${token}`;
  return { token, mcpUrl };
}

export async function handleGetMcpToken(ctx: HandlerContext, _data: unknown) {
  const userId = ensureAuth(ctx);
  ensureAllowedEmail(ctx);

  const tokens = await ctx.db.query('mcpTokens', [{ field: 'userId', op: 'EQUAL', value: userId }]);
  if (tokens.length === 0) return { mcpUrl: null };

  const token = tokens[0].id;
  return { mcpUrl: `https://video-studio-api.gpmarket007.workers.dev/mcp?token=${token}` };
}
