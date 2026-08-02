import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthUser } from '../auth/plugin.js';
import { registerMcpTools } from './tools.js';

const SERVER_NAME = 'video-studio-mcp';
const SERVER_VERSION = '3.0.0';

/**
 * One server per request: the transport is stateless, and binding the caller into the
 * tool closures here is what makes every tool user-scoped by construction.
 */
export function createMcpServer(user: AuthUser): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerMcpTools(server, user);
  return server;
}
