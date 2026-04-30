import type { z } from 'zod';

export type TToolResult<T = unknown> =
    | { success: true; data: T }
    | { success: false; error: string };

export type TToolDefinition<TIn = unknown, TOut = unknown> = {
    description: string;
    schema: z.ZodObject<z.ZodRawShape>;
    handler: (input: TIn) => Promise<TToolResult<TOut>>;
};
