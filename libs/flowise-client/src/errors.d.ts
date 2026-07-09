export declare class FlowiseError extends Error {
    readonly statusCode?: number;
    readonly responseBody?: unknown;
    constructor(message: string, statusCode?: number, responseBody?: unknown);
}
export declare function formatFlowiseError(error: unknown): string;
//# sourceMappingURL=errors.d.ts.map