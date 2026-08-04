import type { McpKeyIssuedDto, McpKeyStatusDto } from '@video-studio/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAuthUser } from '../auth/plugin.js';
import { getEnv } from '../env.js';
import { describeMcpKey, issueMcpToken, revokeMcpToken } from '../mcp/auth.js';

/**
 * Managing the key the Cinema Studio settings page hands to Claude.
 *
 * These are ordinary cookie-authenticated routes — only the signed-in owner can mint or
 * revoke their own key. The key itself authenticates the separate `/mcp` surface.
 */

/** Minting is cheap but a leaked session should not be able to churn keys unbounded. */
const ISSUE_RATE_LIMIT = 10;

function userRateLimitKey(request: FastifyRequest): string {
  return request.authUser?.id ?? request.ip;
}

/** The address a connector dialog is pasted into — must be reachable from the internet. */
function connectorUrl(token: string): string {
  return `${getEnv().apiPublicUrl.replace(/\/+$/, '')}/mcp/k/${token}`;
}

export const mcpKeyRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const issueLimiter = fastify.rateLimit({
    max: ISSUE_RATE_LIMIT,
    timeWindow: '1 minute',
    keyGenerator: userRateLimitKey,
  });

  fastify.get('/key', { preHandler: fastify.authenticate }, async (request) => {
    const user = requireAuthUser(request);
    const status = await describeMcpKey(user.id);

    const dto: McpKeyStatusDto = { enabled: getEnv().mcpEnabled, hasKey: status.hasKey };
    if (status.hint !== undefined) dto.hint = status.hint;
    if (status.createdAt) dto.createdAt = status.createdAt.toISOString();
    if (status.lastUsedAt) dto.lastUsedAt = status.lastUsedAt.toISOString();
    return dto;
  });

  /**
   * Issues a key and returns the connector URL. Rotating is the revocation story: the
   * unique index on the owner means the previous key stops working immediately.
   *
   * This is the only response that ever carries the secret — nothing logs it, and no
   * later read can recover it.
   */
  fastify.post(
    '/key',
    { preHandler: [fastify.authenticate, issueLimiter] },
    async (request, reply) => {
      const user = requireAuthUser(request);
      const issued = await issueMcpToken(user.id);

      const dto: McpKeyIssuedDto = {
        url: connectorUrl(issued.token),
        hint: issued.hint,
        createdAt: issued.createdAt.toISOString(),
      };
      return await reply.code(201).send(dto);
    },
  );

  fastify.delete('/key', { preHandler: fastify.authenticate }, async (request, reply) => {
    const user = requireAuthUser(request);
    await revokeMcpToken(user.id);
    return await reply.code(204).send();
  });
};
