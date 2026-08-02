import cors from 'cors';
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import type { Config } from './config.js';
import { HttpError, isHttpError } from './errors.js';
import { log } from './logger.js';
import { diagnosticsRouter } from './routes/diagnostics.js';
import { videoRouter } from './routes/video.js';
import { setRuntimeConfig } from './runtimeConfig.js';

const BODY_LIMIT = '1mb';

/** body-parser tags its own failures; anything else here is a real bug. */
function bodyParserCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const type = (err as { type?: unknown }).type;
  return typeof type === 'string' && type.startsWith('entity.') ? type : undefined;
}

const notFound: RequestHandler = (req, _res, next) => {
  next(new HttpError('not-found', `Unknown function: ${req.path.replace(/^\/+/, '')}`));
};

// Four parameters are what makes Express treat this as an error handler.
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const parserCode = bodyParserCode(err);
  if (parserCode !== undefined) {
    const message =
      parserCode === 'entity.too.large'
        ? `Request body exceeds the ${BODY_LIMIT} limit.`
        : 'Invalid JSON body.';
    res.status(400).json({ error: { status: 'invalid-argument', message } });
    return;
  }

  if (isHttpError(err)) {
    res.status(err.status).json({ error: { status: err.code, message: err.message } });
    return;
  }

  // Unexpected failures may carry internals in their message, so the stack and
  // the message are logged and the client gets a fixed string.
  log('error', 'unhandled error', {
    path: req.path,
    stack: err instanceof Error ? err.stack : String(err),
  });
  res.status(500).json({ error: { status: 'internal', message: 'Internal server error.' } });
};

export function createApp(config: Config): Express {
  setRuntimeConfig(config);

  const app = express();
  app.disable('x-powered-by');

  app.use(
    cors({
      // No configured origins means no browser restriction, matching the
      // worker this server replaces; auth is what actually guards the routes.
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86_400,
    }),
  );
  app.use(express.json({ limit: BODY_LIMIT }));

  // Mounted at root: the frontend calls `${BASE}/${functionName}` directly.
  app.use(videoRouter);
  app.use(diagnosticsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
