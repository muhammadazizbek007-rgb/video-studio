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

type McpTokenRecord = {
  userId: Types.ObjectId;
  tokenHash: string;
  createdAt: Date;
};

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

export async function resolveMcpUser(request: McpAuthCarrier): Promise<AuthUser> {
  const token = readBearer(request);
  await ensureIndexes();

  const record = await tokens().findOne({ tokenHash: hashToken(token) });
  if (!record) {
    throw new ApiError('unauthenticated', 'This MCP token is not valid. Issue a new one.');
  }

  const user = await UserModel.findById(record.userId).exec();
  if (!user) {
    throw new ApiError('unauthenticated', 'The account behind this MCP token no longer exists.');
  }
  assertEmailAllowed(user.email);

  return { id: user._id.toString(), email: user.email, name: user.name };
}

/** Returns the only copy of the token that will ever exist — the store keeps the hash. */
export async function issueMcpToken(userId: string): Promise<string> {
  const owner = toUserObjectId(userId);
  await ensureIndexes();

  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
  await tokens().updateOne(
    { userId: owner },
    { $set: { userId: owner, tokenHash: hashToken(token), createdAt: new Date() } },
    { upsert: true },
  );

  return token;
}

export async function revokeMcpToken(userId: string): Promise<void> {
  await tokens().deleteMany({ userId: toUserObjectId(userId) });
}
