import { createHash, randomBytes } from 'node:crypto';
import type { Collection } from 'mongoose';
import mongoose, { Types } from 'mongoose';
import { type AuthUser, assertEmailAllowed } from '../auth/plugin.js';
import { UserModel } from '../db/models/user.js';
import { ApiError } from '../errors.js';

/**
 * MCP tokens live in their own raw collection rather than in Session: a Session row is
 * whatever `/api/auth/refresh` will trade for browser cookies, so parking a long-lived
 * MCP secret there would turn every MCP token into a session-minting credential.
 */
const COLLECTION = 'mcptokens';

const TOKEN_PREFIX = 'vsmcp_';
const TOKEN_BYTES = 32;
const BEARER = /^Bearer\s+(\S+)$/i;

/** How many trailing characters of a key are safe to show back to its owner. */
const HINT_LENGTH = 6;

type McpTokenRecord = {
  userId: Types.ObjectId;
  tokenHash: string;
  /** Last few characters of the key — never enough to reconstruct it. */
  hint: string;
  createdAt: Date;
  lastUsedAt?: Date;
};

export interface McpKeyStatus {
  hasKey: boolean;
  hint?: string;
  createdAt?: Date;
  lastUsedAt?: Date;
}

export interface IssuedMcpKey {
  /** The only copy of the secret that will ever exist — the store keeps a hash. */
  token: string;
  hint: string;
  createdAt: Date;
}

/** Anything with request headers — keeps this callable from a test without a live server. */
export interface McpAuthCarrier {
  headers: { authorization?: string | undefined };
}

let indexesReady: Promise<void> | null = null;

function tokens(): Collection<McpTokenRecord> {
  return mongoose.connection.collection<McpTokenRecord>(COLLECTION);
}

async function ensureIndexes(): Promise<void> {
  indexesReady ??= (async () => {
    const collection = tokens();
    await collection.createIndex({ tokenHash: 1 }, { unique: true });
    // One live token per account, so issuing a new one always retires the old one.
    await collection.createIndex({ userId: 1 }, { unique: true });
  })();

  try {
    await indexesReady;
  } catch (error) {
    indexesReady = null;
    throw error;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toUserObjectId(userId: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(userId)) {
    throw new ApiError('invalid-argument', 'That is not a valid account id.');
  }
  return new Types.ObjectId(userId);
}

function readBearer(request: McpAuthCarrier): string {
  const header = request.headers.authorization;
  const match = header === undefined ? null : BEARER.exec(header);
  const token = match?.[1] ?? '';
  if (token === '') {
    throw new ApiError('unauthenticated', 'An MCP bearer token is required.');
  }
  return token;
}

/**
 * Resolves the account behind a raw key.
 *
 * Shared by both transports: the `Authorization: Bearer` header for clients that can send
 * one, and the key-in-URL route for Claude's connector dialog, which cannot.
 */
export async function resolveMcpUserByToken(token: string): Promise<AuthUser> {
  if (token.trim() === '') {
    throw new ApiError('unauthenticated', 'An MCP key is required.');
  }
  await ensureIndexes();

  const record = await tokens().findOne({ tokenHash: hashToken(token) });
  if (!record) {
    throw new ApiError('unauthenticated', 'This MCP key is not valid. Issue a new one.');
  }

  const user = await UserModel.findById(record.userId).exec();
  if (!user) {
    throw new ApiError('unauthenticated', 'The account behind this MCP key no longer exists.');
  }
  assertEmailAllowed(user.email);

  // Not awaited: a "last used" stamp is diagnostics, and a write failure must never turn a
  // valid key into a rejected request.
  void tokens()
    .updateOne({ _id: record._id }, { $set: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return { id: user._id.toString(), email: user.email, name: user.name };
}

export async function resolveMcpUser(request: McpAuthCarrier): Promise<AuthUser> {
  return await resolveMcpUserByToken(readBearer(request));
}

/** Metadata only — the secret is unrecoverable once issued. */
export async function describeMcpKey(userId: string): Promise<McpKeyStatus> {
  await ensureIndexes();

  const record = await tokens().findOne({ userId: toUserObjectId(userId) });
  if (!record) return { hasKey: false };

  const status: McpKeyStatus = { hasKey: true, hint: record.hint, createdAt: record.createdAt };
  if (record.lastUsedAt) status.lastUsedAt = record.lastUsedAt;
  return status;
}

/**
 * Issues a key, replacing any existing one.
 *
 * The unique index on `userId` is what enforces one key per account: an upsert here
 * retires the previous key in the same operation, so a compromised key stops working the
 * moment its owner presses the button again.
 */
export async function issueMcpToken(userId: string): Promise<IssuedMcpKey> {
  const owner = toUserObjectId(userId);
  await ensureIndexes();

  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
  const hint = token.slice(-HINT_LENGTH);
  const createdAt = new Date();

  await tokens().updateOne(
    { userId: owner },
    {
      $set: { userId: owner, tokenHash: hashToken(token), hint, createdAt },
      // A rotated key has never been used; leaving the old stamp would misreport it.
      $unset: { lastUsedAt: '' },
    },
    { upsert: true },
  );

  return { token, hint, createdAt };
}

export async function revokeMcpToken(userId: string): Promise<void> {
  await tokens().deleteMany({ userId: toUserObjectId(userId) });
}
