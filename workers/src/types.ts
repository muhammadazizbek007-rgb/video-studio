export interface Env {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_SERVICE_ACCOUNT_JSON: string;
  VIDEO_STUDIO_ALLOWED_EMAILS?: string;
  // Google Vertex AI (Veo / Imagen) — authenticated with FIREBASE_SERVICE_ACCOUNT_JSON
  VERTEX_PROJECT_ID?: string;
  VERTEX_LOCATION?: string;
  FIREBASE_STORAGE_BUCKET?: string;
  // Template slideshow renderer — not AI generation
  JSON2VIDEO_API_KEY?: string;
  // Upscaling only (post-processing, not generation)
  REPLICATE_API_TOKEN?: string;
  // Prompt enrichment only (no image/video generation)
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
