import { z } from 'zod';

export interface Env {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: string;
  mongoUri: string;
  webAppUrl: string;
  apiPublicUrl: string;
  authJwtSecret: string;
  googleClientId: string;
  googleClientSecret: string;
  allowedEmails: string[];
  authDevLogin: boolean;
  gcpProjectId: string;
  vertexLocation: string;
  googleServiceAccount: { client_email: string; private_key: string; project_id: string } | null;
  mediaRoot: string;
  mediaPublicBaseUrl: string;
  anthropicApiKey: string | null;
  fakeVertex: boolean;
  mcpEnabled: boolean;
  corsOrigins: string[];
  /** Generations a single account may start per minute, across the studio and storyboards. */
  generationRateLimitPerMinute: number;
  reconcilerEnabled: boolean;
  reconcilerIntervalMs: number;
  /** Minimum gap between two Vertex submissions for the same base model. */
  veoSubmitIntervalMs: number;
  /** How many times a submission may be refused by the quota before the clip is failed. */
  veoSubmitMaxAttempts: number;
  ffmpegPath: string;
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

/** Secret managers routinely prepend a BOM when they hand a value to the process. */
function clean(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const stripped = value.replace(/^\uFEFF/, '').trim();
  return stripped === '' ? undefined : stripped;
}

function readRaw(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    const cleaned = clean(value);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const lower = value.toLowerCase();
  if (TRUE_VALUES.has(lower)) return true;
  if (FALSE_VALUES.has(lower)) return false;
  return fallback;
}

function toList(value: string | undefined, lowercase: boolean): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => (lowercase ? entry.trim().toLowerCase() : entry.trim()))
    .filter((entry) => entry.length > 0);
}

const booleanish = z
  .string()
  .refine(
    (value) => TRUE_VALUES.has(value.toLowerCase()) || FALSE_VALUES.has(value.toLowerCase()),
    'must be one of true, false, 1, 0, yes, no, on, off',
  )
  .optional();

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.string().min(1).default('info'),
  MONGODB_URI: z.string().min(1, 'is required'),
  WEB_APP_URL: z.string().min(1).default('http://localhost:5173'),
  API_PUBLIC_URL: z.string().min(1).default('http://localhost:8080'),
  AUTH_JWT_SECRET: z.string().min(32, 'must be at least 32 characters long'),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  ALLOWED_EMAILS: z.string().optional(),
  AUTH_DEV_LOGIN: booleanish,
  GCP_PROJECT_ID: z.string().min(1).optional(),
  VERTEX_LOCATION: z.string().min(1).default('us-central1'),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
  MEDIA_ROOT: z.string().min(1).default('./var/media'),
  MEDIA_PUBLIC_BASE_URL: z.string().min(1).default('/media'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  FAKE_VERTEX: booleanish,
  MCP_ENABLED: booleanish,
  CORS_ORIGINS: z.string().optional(),
  // A twelve-segment storyboard is twelve starts in quick succession, so the studio's old
  // hard-coded ten per minute is a limit real use hits rather than an abuse ceiling.
  GENERATION_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(40),
  RECONCILER_ENABLED: booleanish,
  RECONCILER_INTERVAL_MS: z.coerce.number().int().min(5_000).max(600_000).default(30_000),
  // Vertex allows one predictLongRunning per minute per base model, and refuses the rest
  // with a 429 rather than queueing them. The default mirrors that ceiling exactly; raise
  // it here after Google grants a higher quota.
  VEO_SUBMIT_INTERVAL_MS: z.coerce.number().int().min(0).max(600_000).default(60_000),
  // A clip waiting behind a full campaign can be refused many times before its turn, and
  // giving up early is what the queue exists to prevent.
  VEO_SUBMIT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(20),
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
});

type ServiceAccount = NonNullable<Env['googleServiceAccount']>;

type ServiceAccountResult = { ok: true; value: ServiceAccount } | { ok: false; problem: string };

const serviceAccountSchema = z.object({
  project_id: z.string().min(1),
  client_email: z.string().min(1),
  private_key: z.string().min(1),
});

function parseServiceAccount(json: string): ServiceAccountResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    return {
      ok: false,
      problem: 'GOOGLE_SERVICE_ACCOUNT_JSON: is not valid JSON (paste the key file on one line)',
    };
  }

  const parsed = serviceAccountSchema.safeParse(decoded);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    return {
      ok: false,
      problem: `GOOGLE_SERVICE_ACCOUNT_JSON: missing or empty field(s): ${missing}`,
    };
  }

  return {
    ok: true,
    value: {
      project_id: parsed.data.project_id,
      client_email: parsed.data.client_email,
      // The key survives shell/YAML round-trips as literal backslash-n sequences.
      private_key: parsed.data.private_key.replace(/\\n/g, '\n'),
    },
  };
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.') || '(root)';
    return `${path}: ${issue.message}`;
  });
}

function buildEnv(source: NodeJS.ProcessEnv): Env {
  const raw = readRaw(source);
  const shape = rawSchema.safeParse(raw);
  const problems: string[] = shape.success ? [] : formatIssues(shape.error);

  // Cross-field rules run against the raw values so that a shape failure elsewhere
  // never hides them — an operator should be able to fix everything in one pass.
  const authDevLogin = toBoolean(raw.AUTH_DEV_LOGIN, false);
  const fakeVertex = toBoolean(raw.FAKE_VERTEX, false);

  if (!authDevLogin) {
    if (!raw.GOOGLE_OAUTH_CLIENT_ID) {
      problems.push('GOOGLE_OAUTH_CLIENT_ID: is required unless AUTH_DEV_LOGIN=true');
    }
    if (!raw.GOOGLE_OAUTH_CLIENT_SECRET) {
      problems.push('GOOGLE_OAUTH_CLIENT_SECRET: is required unless AUTH_DEV_LOGIN=true');
    }
  }

  let serviceAccount: ServiceAccount | null = null;
  if (raw.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const result = parseServiceAccount(raw.GOOGLE_SERVICE_ACCOUNT_JSON);
    if (result.ok) {
      serviceAccount = result.value;
    } else {
      problems.push(result.problem);
    }
  } else if (!fakeVertex) {
    problems.push('GOOGLE_SERVICE_ACCOUNT_JSON: is required unless FAKE_VERTEX=true');
  }

  const gcpProjectId = raw.GCP_PROJECT_ID ?? serviceAccount?.project_id ?? '';
  if (!gcpProjectId && !fakeVertex) {
    problems.push('GCP_PROJECT_ID: is required unless FAKE_VERTEX=true');
  }

  if (problems.length > 0 || !shape.success) {
    throw new Error(
      `Invalid environment configuration (${problems.length} problem(s)):\n${problems
        .map((problem) => `  - ${problem}`)
        .join('\n')}`,
    );
  }

  const data = shape.data;
  const corsOrigins = toList(raw.CORS_ORIGINS, false);

  return {
    nodeEnv: data.NODE_ENV,
    port: data.PORT,
    logLevel: data.LOG_LEVEL,
    mongoUri: data.MONGODB_URI,
    webAppUrl: data.WEB_APP_URL,
    apiPublicUrl: data.API_PUBLIC_URL,
    authJwtSecret: data.AUTH_JWT_SECRET,
    googleClientId: data.GOOGLE_OAUTH_CLIENT_ID ?? '',
    googleClientSecret: data.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
    allowedEmails: toList(raw.ALLOWED_EMAILS, true),
    authDevLogin,
    gcpProjectId,
    vertexLocation: data.VERTEX_LOCATION,
    googleServiceAccount: serviceAccount,
    mediaRoot: data.MEDIA_ROOT,
    mediaPublicBaseUrl: data.MEDIA_PUBLIC_BASE_URL,
    anthropicApiKey: data.ANTHROPIC_API_KEY ?? null,
    fakeVertex,
    mcpEnabled: toBoolean(raw.MCP_ENABLED, true),
    // Falling back to the web origin keeps a single-origin deployment working unconfigured.
    corsOrigins: corsOrigins.length > 0 ? corsOrigins : [data.WEB_APP_URL],
    generationRateLimitPerMinute: data.GENERATION_RATE_LIMIT_PER_MINUTE,
    // Off under test: a sweep firing inside a test run would race its fixtures.
    reconcilerEnabled: toBoolean(raw.RECONCILER_ENABLED, data.NODE_ENV !== 'test'),
    reconcilerIntervalMs: data.RECONCILER_INTERVAL_MS,
    // The fake driver never reaches Vertex, so spacing submissions would only make the
    // offline path and the test suite slow for no reason.
    veoSubmitIntervalMs: fakeVertex ? 0 : data.VEO_SUBMIT_INTERVAL_MS,
    veoSubmitMaxAttempts: data.VEO_SUBMIT_MAX_ATTEMPTS,
    ffmpegPath: data.FFMPEG_PATH,
  };
}

let cached: Env | null = null;

export function getEnv(): Env {
  cached ??= buildEnv(process.env);
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}
