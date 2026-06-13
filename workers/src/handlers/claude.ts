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

export async function handleGetClaudeSettings(ctx: HandlerContext, _data: unknown) {
  const userId = ensureAuth(ctx);
  ensureAllowedEmail(ctx);

  const snap = await ctx.db.get('videoStudioSettings', userId);
  const data = snap || {};
  return {
    hasApiKey: Boolean(String(data.claudeApiKey || '').trim()),
    mcpUrl: String(data.claudeMcpUrl || '').trim() || null,
  };
}

export async function handleSaveClaudeSettings(ctx: HandlerContext, data: unknown) {
  const userId = ensureAuth(ctx);
  ensureAllowedEmail(ctx);

  const d = data as Record<string, unknown>;
  const apiKey = String(d?.apiKey || '').trim();
  const mcpUrl = String(d?.mcpUrl || '').trim();
  if (!apiKey && !mcpUrl) throw new HttpsError('invalid-argument', 'Укажите API-ключ или MCP URL.');

  const update: Record<string, unknown> = {};
  if (apiKey) update.claudeApiKey = apiKey;
  if (mcpUrl) update.claudeMcpUrl = mcpUrl;

  await ctx.db.upsertWithTransforms('videoStudioSettings', userId, update, [
    { field: 'updatedAt', type: 'serverTimestamp' },
  ]);

  return { success: true, hasSavedKey: Boolean(apiKey), hasSavedMcpUrl: Boolean(mcpUrl) };
}

export async function handleTestClaudeConnection(ctx: HandlerContext, _data: unknown) {
  const userId = ensureAuth(ctx);
  ensureAllowedEmail(ctx);

  const snap = await ctx.db.get('videoStudioSettings', userId);
  const settings = snap || {};
  const apiKey = String(settings.claudeApiKey || '').trim();
  const mcpUrl = String(settings.claudeMcpUrl || '').trim();

  if (!apiKey) return { status: 'error', hasApiKey: false, hasMcpUrl: Boolean(mcpUrl), model: null, message: 'API-ключ Claude не найден.' };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 5, messages: [{ role: 'user', content: 'Hi' }] }),
    });

    const body = await res.json() as Record<string, unknown>;

    if (res.status === 200) {
      return { status: 'ok', hasApiKey: true, hasMcpUrl: Boolean(mcpUrl), mcpUrl: mcpUrl || null, model: body.model || 'claude-haiku-4-5', message: 'Claude API подключён успешно.' };
    }
    if (res.status === 401) return { status: 'error', hasApiKey: true, hasMcpUrl: Boolean(mcpUrl), model: null, message: 'API-ключ недействителен (401).' };

    const errBody = body as { error?: { message?: string } };
    return { status: 'error', hasApiKey: true, hasMcpUrl: Boolean(mcpUrl), model: null, message: `Ошибка API: ${errBody?.error?.message || `HTTP ${res.status}`}` };
  } catch (err) {
    return { status: 'error', hasApiKey: true, hasMcpUrl: Boolean(mcpUrl), model: null, message: `Ошибка подключения: ${err instanceof Error ? err.message : String(err)}` };
  }
}
