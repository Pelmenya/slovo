import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { tools } from './tools';
import type { TToolDefinition } from './tools/t-tool';

// Каждое значение в registry имеет свой узкий TIn для compile-time проверки в satisfies,
// но при итерации TS пересекает все TIn в never. Сужаем tool к базовому контракту через
// промежуточную переменную — это безопасно потому что schema.parse выше валидирует input.
type TAnyTool = TToolDefinition<unknown, unknown>;

export function createServer(): McpServer {
    const server = new McpServer({
        name: 'mcp-flowise',
        version: '0.0.1',
    });

    for (const [name, tool] of Object.entries(tools) as Array<[string, TAnyTool]>) {
        server.registerTool(
            name,
            {
                description: tool.description,
                inputSchema: tool.schema,
            },
            async (args: unknown) => {
                const parsed: unknown = tool.schema.parse(args);
                const result = await tool.handler(parsed);
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
