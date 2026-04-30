import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { z } from 'zod';
import { tools } from './tools';

export function createServer(): McpServer {
    const server = new McpServer({
        name: 'mcp-flowise',
        version: '0.0.1',
    });

    for (const [name, tool] of Object.entries(tools)) {
        server.registerTool(
            name,
            {
                description: tool.description,
                inputSchema: tool.schema as z.ZodObject<z.ZodRawShape>,
            },
            async (args: unknown) => {
                const result = await tool.handler(args);
                if (!result.success) {
                    return {
                        content: [{ type: 'text' as const, text: result.error }],
                        isError: true,
                    };
                }
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify(result.data, null, 2),
                        },
                    ],
                };
            },
        );
    }

    return server;
}

export async function runServer(): Promise<void> {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
