import { pino } from 'pino';
import { getEnv } from './env.js';

const env = getEnv();

/**
 * The MCP connector key rides in the URL path, because Claude's connector dialog offers no
 * way to send a header. That makes the request line itself a secret — pino logs `req.url`
 * on every request, so without this the key would be written to the journal the first time
 * anyone used it, and `redact` cannot reach inside a string.
 */
const MCP_KEY_IN_PATH = /(\/mcp\/k\/)[^/?#]+/;

function scrubUrl(url: string): string {
  return url.replace(MCP_KEY_IN_PATH, '$1[redacted]');
}

/** Fastify hands its own Request here; only these fields are read, all defensively. */
interface LoggableRequest {
  method?: unknown;
  url?: unknown;
  headers?: { host?: unknown };
  ip?: unknown;
  socket?: { remotePort?: unknown };
}

export const logger = pino({
  level: env.logLevel,
  serializers: {
    // Mirrors Fastify's default req serializer, with the URL scrubbed. Replacing it is the
    // only hook that sees the URL before it is written.
    req(request: LoggableRequest) {
      const url = request.url;
      return {
        method: request.method,
        url: typeof url === 'string' ? scrubUrl(url) : url,
        host: request.headers?.host,
        remoteAddress: request.ip,
        remotePort: request.socket?.remotePort,
      };
    },
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'private_key',
      '*.private_key',
    ],
    censor: '[redacted]',
  },
  ...(env.nodeEnv === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
        },
      }
    : {}),
});
