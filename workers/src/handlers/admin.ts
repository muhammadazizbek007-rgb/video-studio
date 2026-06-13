import { HttpsError, type HandlerContext } from '../types';

export async function handleSetAdminClaim(ctx: HandlerContext, data: unknown) {
  if (!ctx.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in is required.');

  const d = data as Record<string, unknown>;
  const targetEmail = String(d?.email || '').trim().toLowerCase();
  if (!targetEmail) throw new HttpsError('invalid-argument', 'Email обязателен.');

  const bootstrapDoc = await ctx.db.get('_adminBootstrap', 'config');
  const isInitialized = bootstrapDoc?.initialized === true;
  if (isInitialized && !ctx.auth.admin) {
    throw new HttpsError('permission-denied', 'Только администратор может выдавать права администратора.');
  }

  const sa = JSON.parse(ctx.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const { getAccessToken } = await import('../google-auth');
  const accessToken = await getAccessToken(sa);

  // Look up user by email via Firebase Auth REST API
  const lookupRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: [targetEmail] }),
  });

  if (!lookupRes.ok) throw new HttpsError('internal', `Firebase Auth lookup failed: ${lookupRes.status}`);
  const lookupData = await lookupRes.json() as { users?: Array<{ localId: string }> };
  if (!lookupData.users?.length) throw new HttpsError('not-found', `Пользователь ${targetEmail} не найден.`);

  const uid = lookupData.users[0].localId;

  // Set custom claims via Firebase Auth REST API
  const claimsRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify({ admin: true }) }),
  });

  if (!claimsRes.ok) throw new HttpsError('internal', `Failed to set admin claim: ${claimsRes.status}`);

  if (!isInitialized) {
    await ctx.db.setWithServerTimestamp('_adminBootstrap', 'config', {
      initialized: true, firstAdminEmail: targetEmail,
    }, ['createdAt']);
  }

  return { success: true, message: `Права администратора выданы для ${targetEmail}.` };
}
