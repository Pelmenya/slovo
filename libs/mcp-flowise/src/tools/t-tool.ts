import type { z } from 'zod';

export type TToolResult<T = unknown> =
    | { success: true; data: T }
    | { success: false; error: string };

export type TToolHandler = (input: unknown) => Promise<TToolResult>;

export type TToolDefinition = {
    description: string;
    schema: z.ZodObject<z.ZodRawShape>;
    handler: TToolHandler;
};
