import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyPluginAsync } from 'fastify';
import { ApiError } from '../errors.js';
import { resolveMcpUser } from './auth.js';
import { createMcpServer } from './server.js';

const JSON_RPC_INTERNAL_ERROR = -32603;
const JSON_RPC_CONNECTION_CLOSED = -32000;

const METHOD_NOT_ALLOWED = {
  jsonrpc: '2.0',
  error: { code: JSON_RPC_CONNECTION_CLOSED, message: 'Method not allowed.' },
  id: null,
};

export const mcpRoutes: FastifyPluginAsync = async (fastify) => {
  // Scoped to this plugin so the rest of the API keeps Fastify's own JSON parser: the
  // transport is handed the already-parsed body and must not re-read the raw stream.
  fastify.addContentTypeParser<string>(
    'application/json',
    { parseAs: 'string' },
    (_request, body, done) => {
      if (body.trim() === '') {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body) as unknown);
      } catch {
        done(
          new ApiError('invalid-argument', 'The MCP request body is not valid JSON.'),
          undefined,
        );
      }
    },
  );

  fastify.post('/', async (request, reply) => {
    // Resolved before the transport exists so an auth failure still travels the normal
    // Fastify error path and lands in the shared error envelope.
    const user = await resolveMcpUser(request);

    const server = createMcpServer(user);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    reply.raw.on('close', () => {
      void transport.close().catch((error: unknown) => {
        request.log.warn({ err: error }, 'could not close the mcp transport');
      });
      void server.close().catch((error: unknown) => {
        request.log.warn({ err: error }, 'could not close the mcp server');
      });
    });

    await server.connect(transport);
    reply.hijack();

    try {
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      request.log.error({ err: error }, 'mcp request failed');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: JSON_RPC_INTERNAL_ERROR, message: 'Internal server error.' },
            id: null,
          }),
        );
      } else {
        reply.raw.end();
      }
    }
  });

  // Stateless mode has no stream to resume, so the server-initiated SSE channel is refused.
  fastify.get('/', async (_request, reply) =>
    reply.code(405).header('allow', 'POST').send(METHOD_NOT_ALLOWED),
  );
};
