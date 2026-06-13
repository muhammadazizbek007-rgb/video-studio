interface JWK {
  kid: string;
  n: string;
  e: string;
}

interface FirebaseClaims {
  uid: string;
  email?: string;
  admin?: boolean;
}

const FIREBASE_CERT_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let cachedKeys: { keys: JWK[]; expiresAt: number } | null = null;

async function getPublicKeys(): Promise<JWK[]> {
  const now = Date.now();
  if (cachedKeys && now < cachedKeys.expiresAt) return cachedKeys.keys;

  const res = await fetch(FIREBASE_CERT_URL);
  if (!res.ok) throw new Error('Failed to fetch Firebase public keys');

  const maxAge = res.headers.get('Cache-Control')?.match(/max-age=(\d+)/)?.[1];
  const ttl = maxAge ? Number(maxAge) * 1000 : 3600 * 1000;

  const json = await res.json() as { keys: JWK[] };
  cachedKeys = { keys: json.keys, expiresAt: now + ttl };
  return json.keys;
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(str.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function importRsaKey(jwk: JWK): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', use: 'sig' },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

export async function verifyFirebaseToken(token: string, projectId: string): Promise<FirebaseClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  const [headerB64, payloadB64, signatureB64] = parts;

  const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/'))) as { kid?: string; alg?: string };
  if (header.alg !== 'RS256') throw new Error('Unsupported algorithm');
  if (!header.kid) throw new Error('Missing kid');

  const keys = await getPublicKeys();
  const matchingKey = keys.find((k) => k.kid === header.kid);
  if (!matchingKey) throw new Error('No matching public key');

  const cryptoKey = await importRsaKey(matchingKey);
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = base64UrlDecode(signatureB64);

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    signature,
    new TextEncoder().encode(signingInput),
  );
  if (!valid) throw new Error('Invalid signature');

  const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'))) as {
    iss?: string; aud?: string; sub?: string; uid?: string;
    exp?: number; iat?: number; email?: string; firebase?: { sign_in_provider?: string };
    admin?: boolean;
  };

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) throw new Error('Token expired');
  if (!payload.iat || payload.iat > now + 300) throw new Error('Token issued in the future');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Invalid issuer');
  if (payload.aud !== projectId) throw new Error('Invalid audience');

  const uid = payload.sub || payload.uid;
  if (!uid) throw new Error('Missing uid');

  return { uid, email: payload.email, admin: Boolean(payload.admin) };
}
