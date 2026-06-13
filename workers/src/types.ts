export interface Env {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_SERVICE_ACCOUNT_JSON: string;
  VIDEO_STUDIO_ALLOWED_EMAILS?: string;
  SEEDANCE_API_KEY?: string;
  SEEDANCE_API_BASE_URL?: string;
  REPLICATE_API_TOKEN?: string;
  WAVESPEED_API_KEY?: string;
  HUGGINGFACE_API_TOKEN?: string;
  LEONARDO_API_KEY?: string;
  JSON2VIDEO_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

export interface AuthContext {
  uid: string;
  email?: string;
  admin?: boolean;
}

export interface HandlerContext {
  auth: AuthContext | null;
  db: import('./firestore').Firestore;
  env: Env;
  ctx: ExecutionContext;
}

export class HttpsError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'HttpsError';
  }
}
