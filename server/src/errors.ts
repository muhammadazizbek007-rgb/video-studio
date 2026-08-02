export type ErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'invalid-argument'
  | 'not-found'
  | 'resource-exhausted'
  | 'failed-precondition'
  | 'internal';

// Mirrors the codes the frontend already branches on (src/lib/callWorker.ts puts
// `error.status` onto `err.code`), so these strings are part of the wire contract.
const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  unauthenticated: 401,
  'permission-denied': 403,
  'invalid-argument': 400,
  'not-found': 404,
  'resource-exhausted': 429,
  'failed-precondition': 400,
  internal: 500,
};

export class HttpError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

export function isHttpError(e: unknown): e is HttpError {
  return e instanceof HttpError;
}
