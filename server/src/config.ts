export interface Config {
  port: number;
  projectId: string;
  location: string;
  storageBucket: string;
  serviceAccount: { project_id: string; client_email: string; private_key: string };
  allowedEmails: string[];
  corsOrigins: string[];
  anthropicApiKey?: string;
}

const DEFAULT_PORT = 8080;
const DEFAULT_LOCATION = 'us-central1';

// trim() also strips a leading U+FEFF, which secret managers and Windows shells
// routinely prepend to FIREBASE_SERVICE_ACCOUNT_JSON and which would otherwise
// break JSON.parse with an unhelpful "unexpected token" message.
function read(name: string): string {
  return (process.env[name] ?? '').trim();
}

function readList(name: string): string[] {
  return read(name)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parsePort(raw: string, problems: string[]): number {
  if (raw === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push(`PORT must be an integer between 1 and 65535 (got "${raw}")`);
    return DEFAULT_PORT;
  }
  return port;
}

function parseServiceAccount(raw: string, problems: string[]): Config['serviceAccount'] {
  const empty = { project_id: '', client_email: '', private_key: '' };

  if (raw === '') {
    problems.push('FIREBASE_SERVICE_ACCOUNT_JSON is required (raw service account JSON)');
    return empty;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    problems.push('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
    return empty;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    problems.push('FIREBASE_SERVICE_ACCOUNT_JSON must be a JSON object');
    return empty;
  }

  const fields = parsed as Record<string, unknown>;
  const account = { ...empty };

  for (const field of ['project_id', 'client_email', 'private_key'] as const) {
    const value = fields[field];
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`FIREBASE_SERVICE_ACCOUNT_JSON is missing the "${field}" field`);
      continue;
    }
    account[field] = value;
  }

  // Single-line env vars carry the PEM newlines escaped; the Google auth
  // libraries need them restored before they will parse the key.
  account.private_key = account.private_key.replace(/\\n/g, '\n');

  return account;
}

export function loadConfig(): Config {
  const problems: string[] = [];

  const port = parsePort(read('PORT'), problems);
  const serviceAccount = parseServiceAccount(read('FIREBASE_SERVICE_ACCOUNT_JSON'), problems);

  // The service account already names its project, so treat it as the fallback
  // rather than forcing operators to state the same value twice.
  const projectId = read('GOOGLE_CLOUD_PROJECT') || serviceAccount.project_id;
  if (projectId === '') {
    problems.push('GOOGLE_CLOUD_PROJECT is required (no project_id available from the service account)');
  }

  // Deliberately not an HttpError: this runs before any request exists, so an
  // HTTP status would be meaningless. Report every problem at once so an
  // operator fixes the whole deployment in one pass instead of one var per restart.
  if (problems.length > 0) {
    throw new Error(
      `Invalid server configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }

  const config: Config = {
    port,
    projectId,
    location: read('VERTEX_LOCATION') || DEFAULT_LOCATION,
    storageBucket: read('FIREBASE_STORAGE_BUCKET') || `${projectId}.firebasestorage.app`,
    serviceAccount,
    // An empty allow-list means "no email restriction" (see requireAllowedEmail).
    allowedEmails: readList('VIDEO_STUDIO_ALLOWED_EMAILS').map((email) => email.toLowerCase()),
    corsOrigins: readList('CORS_ORIGINS'),
  };

  const anthropicApiKey = read('ANTHROPIC_API_KEY');
  if (anthropicApiKey !== '') config.anthropicApiKey = anthropicApiKey;

  return config;
}
