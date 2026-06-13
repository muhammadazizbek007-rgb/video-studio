import { HttpsError, type HandlerContext } from '../types';

function ensureAuth(ctx: HandlerContext) {
  if (!ctx.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in is required.');
  return ctx.auth.uid;
}

const FREE_CREDITS_ON_SIGNUP = 100;

export async function handleGetUserCredits(ctx: HandlerContext, _data: unknown) {
  const userId = ensureAuth(ctx);
  const snap = await ctx.db.get('users', userId);
  return { credits: snap ? Number(snap.credits ?? 0) : 0 };
}

export async function handleGrantCredits(ctx: HandlerContext, data: unknown) {
  const callerId = ensureAuth(ctx);
  if (!ctx.auth?.admin) throw new HttpsError('permission-denied', 'Только администратор может выдавать кредиты.');

  const d = data as Record<string, unknown>;
  const targetUserId = String(d?.userId || '').trim();
  if (!targetUserId || targetUserId.length > 128) throw new HttpsError('invalid-argument', 'userId обязателен.');
  const amount = Number(d?.amount);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100000) throw new HttpsError('invalid-argument', 'amount должен быть от 1 до 100000.');
  const reason = String(d?.reason || 'Выдано администратором').trim().slice(0, 200);

  let balanceBefore = 0, balanceAfter = 0;

  await ctx.db.runTransaction(async (tx) => {
    const snap = await tx.get('users', targetUserId);
    balanceBefore = Number(snap?.credits || 0);
    balanceAfter = balanceBefore + amount;
    tx.setWithTransforms('users', targetUserId, { credits: balanceAfter }, [{ field: 'creditsUpdatedAt', type: 'serverTimestamp' }]);
    tx.setWithTransforms('creditLogs', crypto.randomUUID().replace(/-/g, ''), {
      userId: targetUserId, type: 'grant', amount, balanceBefore, balanceAfter,
      description: reason, grantedBy: callerId,
    }, [{ field: 'createdAt', type: 'serverTimestamp' }]);
  });

  return { success: true, balanceBefore, balanceAfter, amount };
}

export async function handleRedeemPromoCode(ctx: HandlerContext, data: unknown) {
  const userId = ensureAuth(ctx);
  const d = data as Record<string, unknown>;
  const code = String(d?.code || '').trim().toUpperCase();
  if (!code || code.length > 64) throw new HttpsError('invalid-argument', 'code is required.');

  let creditsGranted = 0;

  await ctx.db.runTransaction(async (tx) => {
    const codeData = await tx.get('promoCodes', code);
    if (!codeData) throw new HttpsError('not-found', 'Промокод не найден.');
    if (!codeData.active) throw new HttpsError('failed-precondition', 'Этот промокод уже неактивен.');

    const usedBy = Array.isArray(codeData.usedBy) ? codeData.usedBy as string[] : [];
    if (usedBy.includes(userId)) throw new HttpsError('already-exists', 'Вы уже использовали этот промокод.');

    const maxUses = Number(codeData.maxUses || 0);
    if (maxUses > 0 && usedBy.length >= maxUses) throw new HttpsError('resource-exhausted', 'Этот промокод исчерпан.');

    creditsGranted = Number(codeData.credits || 0);
    if (creditsGranted <= 0) throw new HttpsError('invalid-argument', 'Промокод не содержит кредитов.');

    const userSnap = await tx.get('users', userId);
    const balanceBefore = Number(userSnap?.credits || 0);
    const balanceAfter = balanceBefore + creditsGranted;

    tx.setWithTransforms('users', userId, { credits: balanceAfter }, [{ field: 'creditsUpdatedAt', type: 'serverTimestamp' }]);
    tx.setWithTransforms('promoCodes', code, { usedCount: usedBy.length + 1 }, [
      { field: 'updatedAt', type: 'serverTimestamp' },
      { field: 'usedBy', type: 'arrayUnion', value: userId },
    ]);
    tx.setWithTransforms('creditLogs', crypto.randomUUID().replace(/-/g, ''), {
      userId, type: 'promo', amount: creditsGranted, promoCode: code,
      balanceBefore, balanceAfter, description: `Промокод: ${code}`,
    }, [{ field: 'createdAt', type: 'serverTimestamp' }]);
  });

  return { success: true, creditsGranted, message: `Начислено ${creditsGranted} кредитов!` };
}

export async function ensureUserCredits(ctx: HandlerContext, userId: string, modelId: string): Promise<{ ok: boolean; remaining: number; cost: number; reason?: string }> {
  const MODEL_CREDITS: Record<string, number> = {
    'wavespeed-wan': 10, 'wavespeed-wan-i2v': 10, 'seedance-2': 25, 'seedance-2-fast': 15,
    'replicate-wan-t2v': 10, 'replicate-wan-i2v': 10, 'replicate-kling': 20, 'replicate-luma': 15,
    'huggingface-cogvideox': 10, 'huggingface-opensora': 10, 'cogvideox-free': 5,
    'ltx-fast': 5, 'svd': 5, 'leonardo-motion': 15, 'json2video': 10,
  };
  const cost = MODEL_CREDITS[modelId] || 10;

  const userSnap = await ctx.db.get('users', userId);
  if (!userSnap || userSnap.credits === undefined) {
    await ctx.db.upsertWithTransforms('users', userId, { credits: FREE_CREDITS_ON_SIGNUP }, [
      { field: 'creditsGrantedAt', type: 'serverTimestamp' },
    ]);
    await ctx.db.add('creditLogs', { userId, type: 'signup', amount: FREE_CREDITS_ON_SIGNUP, balanceBefore: 0, balanceAfter: FREE_CREDITS_ON_SIGNUP, description: 'Приветственные кредиты' });
    return { ok: true, remaining: FREE_CREDITS_ON_SIGNUP, cost };
  }

  const credits = Number(userSnap.credits || 0);
  if (credits < cost) return { ok: false, remaining: credits, cost, reason: `Недостаточно кредитов. Нужно ${cost}, доступно ${credits}.` };
  return { ok: true, remaining: credits, cost };
}

export async function deductCredits(ctx: HandlerContext, userId: string, modelId: string): Promise<void> {
  const MODEL_CREDITS: Record<string, number> = {
    'wavespeed-wan': 10, 'wavespeed-wan-i2v': 10, 'seedance-2': 25, 'seedance-2-fast': 15,
    'replicate-wan-t2v': 10, 'replicate-wan-i2v': 10, 'replicate-kling': 20, 'replicate-luma': 15,
    'huggingface-cogvideox': 10, 'huggingface-opensora': 10, 'cogvideox-free': 5,
    'ltx-fast': 5, 'svd': 5, 'leonardo-motion': 15, 'json2video': 10,
  };
  const cost = MODEL_CREDITS[modelId] || 10;

  await ctx.db.runTransaction(async (tx) => {
    const snap = await tx.get('users', userId);
    const balanceBefore = Number(snap?.credits || 0);
    const balanceAfter = Math.max(0, balanceBefore - cost);
    tx.setWithTransforms('users', userId, { credits: balanceAfter }, [{ field: 'creditsUpdatedAt', type: 'serverTimestamp' }]);
    tx.setWithTransforms('creditLogs', crypto.randomUUID().replace(/-/g, ''), {
      userId, type: 'deduction', amount: -cost, modelId, balanceBefore, balanceAfter,
      description: `Генерация видео: ${modelId}`,
    }, [{ field: 'createdAt', type: 'serverTimestamp' }]);
  });
}

export async function checkRateLimit(ctx: HandlerContext, userId: string): Promise<void> {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;

  await ctx.db.runTransaction(async (tx) => {
    const snap = await tx.get('rateLimits', userId);
    const timestamps = ((snap?.timestamps as number[]) || []).filter((ts) => ts > oneHourAgo);
    if (timestamps.length >= 10) {
      const waitMin = Math.ceil((Math.min(...timestamps) + 60 * 60 * 1000 - now) / 60000);
      throw new HttpsError('resource-exhausted', `Превышен лимит: 10 генераций в час. Попробуйте через ${waitMin} мин.`);
    }
    timestamps.push(now);
    tx.setWithTransforms('rateLimits', userId, { timestamps }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);
  });
}
