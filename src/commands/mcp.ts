import { Command } from 'commander';
import { runMcpServer } from '../mcp/server.js';

export function createMcpCommand(): Command {
  const cmd = new Command('mcp').description('Run Help Scout MCP server');

  cmd.action(async () => {
    await runMcpServer();
  });

  return cmd;
}
