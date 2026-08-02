type Level = 'info' | 'warn' | 'error';

// Context objects are assembled ad hoc at call sites, so a caller can easily
// pass a whole request body or config slice. Redacting by key name means a
// leaked secret needs a deliberate rename rather than a moment of inattention.
const SECRET_KEY = /key|token|secret|password|credential|authorization|private/i;

const REDACTED = '[redacted]';

function sanitize(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    out[key] = SECRET_KEY.test(key) ? REDACTED : value;
  }
  return out;
}

export function log(level: Level, message: string, context?: Record<string, unknown>): void {
  const entry = {
    level,
    message,
    time: new Date().toISOString(),
    ...(context ? sanitize(context) : {}),
  };

  // JSON.stringify throws on circular structures; a logging failure must never
  // take down the request that was being logged.
  let line: string;
  try {
    line = JSON.stringify(entry);
  } catch {
    line = JSON.stringify({ level, message, time: entry.time, context: '[unserializable]' });
  }

  process.stdout.write(`${line}\n`);
}
