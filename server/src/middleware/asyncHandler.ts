import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 ignores returned promises, so a rejection inside an async handler
 * escapes as an unhandled rejection instead of reaching the error handler.
 * Every async route and middleware in this server goes through here.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}
