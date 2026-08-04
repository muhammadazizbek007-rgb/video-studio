import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { FastifyError, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { authPlugin } from './auth/plugin.js';
import { authRoutes } from './auth/routes.js';
import { getEnv } from './env.js';
import { ApiError, type ApiErrorCode, isApiError } from './errors.js';
import { logger } from './logger.js';
import { elementRoutes } from './routes/elements.js';
import { generationRoutes } from './routes/generations.js';
import { healthRoutes } from './routes/health.js';
import { mcpKeyRoutes } from './routes/mcpKeys.js';
import { mediaRoutes } from './routes/media.js';
import { modelsRoutes } from './routes/models.js';
import { promptRoutes } from './routes/prompt.js';
import { storyboardRoutes } from './routes/storyboards.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const GLOBAL_RATE_LIMIT = 300;

const CODE_BY_STATUS: Readonly<Record<number, ApiErrorCode>> = {
  400: 'invalid-argument',
  401: 'unauthenticated',
  403: 'permission-denied',
  404: 'not-found',
  413: 'invalid-argument',
  415: 'invalid-argument',
  422: 'invalid-argument',
  429: 'rate-limited',
};

interface ErrorBody {
  status: number;
  code: ApiErrorCode;
  message: string;
}

function describeIssues(issues: readonly { instancePath?: string; message?: string }[]): string {
  const parts = issues.map((issue) => {
    const path = (issue.instancePath ?? '').replace(/^\//, '').replace(/\//g, '.');
    const message = issue.message ?? 'is invalid';
    return path === '' ? message : `${path}: ${message}`;
  });
  return parts.length === 0
    ? 'The request payload is invalid.'
    : `The request payload is invalid — ${parts.join('; ')}`;
}

// Fastify hands the error handler an `unknown`, which is honest: a route can throw
// anything at all. Everything below narrows rather than assumes.
function toErrorBody(error: unknown, request: FastifyRequest): ErrorBody {
  if (isApiError(error)) {
    return { status: error.statusCode, code: error.code, message: error.message };
  }

  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => ({
      instancePath: `/${issue.path.join('/')}`,
      message: issue.message,
    }));
    return { status: 400, code: 'invalid-argument', message: describeIssues(issues) };
  }

  const fastifyError = error as Partial<FastifyError>;

  if (Array.isArray(fastifyError.validation)) {
    return {
      status: 400,
      code: 'invalid-argument',
      message: describeIssues(fastifyError.validation),
    };
  }

  const status = typeof fastifyError.statusCode === 'number' ? fastifyError.statusCode : 500;
  if (status >= 400 && status < 500) {
    const message = typeof fastifyError.message === 'string' ? fastifyError.message : '';
    return {
      status,
      code: CODE_BY_STATUS[status] ?? 'invalid-argument',
      message: message === '' ? 'The request was rejected.' : message,
    };
  }

  // Anything left is a bug or a dependency failure: log it whole, tell the client nothing.
  request.log.error({ err: error }, 'unhandled request error');
  return { status: 500, code: 'internal', message: 'Something went wrong. Please try again.' };
}

function createServer() {
  return Fastify({
    loggerInstance: logger,
    trustProxy: true,
    genReqId(request) {
      const header = request.headers['x-request-id'];
      const value = Array.isArray(header) ? header[0] : header;
      return value !== undefined && value !== '' ? value : randomUUID();
    },
  }).withTypeProvider<ZodTypeProvider>();
}

// Inferred rather than spelled out: naming the five FastifyInstance generics by hand
// drifts the moment the logger or type provider changes, and the mismatch surfaces
// as an unreadable assignability error at every call site.
export type AppInstance = ReturnType<typeof createServer>;

export async function buildApp(): Promise<AppInstance> {
  const env = getEnv();

  const app = createServer();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Installed before anything is registered so every child context inherits them.
  app.setErrorHandler((error, request, reply) => {
    const body = toErrorBody(error, request);
    return reply.code(body.status).send({ error: { code: body.code, message: body.message } });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: { code: 'not-found', message: `Route ${request.method} ${request.url} not found.` },
    }),
  );

  await app.register(helmet, {
    // A JSON API gains nothing from a CSP, and /media has to stay loadable by the
    // web origin's <img>/<video>, which a same-origin CORP would block.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  // A wildcard origin is incompatible with cookie auth, so the allow-list is explicit.
  await app.register(cors, {
    origin: env.corsOrigins.length > 0 ? env.corsOrigins : [env.webAppUrl],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    global: true,
    max: GLOBAL_RATE_LIMIT,
    timeWindow: '1 minute',
    // Returning an Error keeps the 429 on the single error-envelope path, whether
    // the plugin sends it or throws it.
    errorResponseBuilder: () =>
      new ApiError('rate-limited', 'Too many requests. Please slow down and try again shortly.'),
  });

  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 16 },
  });

  const mediaRoot = resolve(env.mediaRoot);
  await mkdir(mediaRoot, { recursive: true });
  await app.register(fastifyStatic, {
    root: mediaRoot,
    prefix: '/media/',
    decorateReply: false,
    index: false,
    dotfiles: 'deny',
  });

  await app.register(authPlugin);

  await app.register(healthRoutes, { prefix: '/api/health' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(modelsRoutes, { prefix: '/api' });
  await app.register(generationRoutes, { prefix: '/api/generations' });
  await app.register(storyboardRoutes, { prefix: '/api/storyboards' });
  await app.register(elementRoutes, { prefix: '/api/elements' });
  await app.register(mediaRoutes, { prefix: '/api/media' });
  await app.register(promptRoutes, { prefix: '/api/prompt' });
  // Registered even when MCP is switched off, so the settings page can say so rather than
  // failing an unexplained request.
  await app.register(mcpKeyRoutes, { prefix: '/api/mcp' });

  if (env.mcpEnabled) {
    // Imported on demand so a deployment with MCP off never loads the SDK.
    const { mcpRoutes } = await import('./mcp/index.js');
    await app.register(mcpRoutes, { prefix: '/mcp' });
  }

  return app;
}
