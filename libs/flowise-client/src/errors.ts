export class FlowiseError extends Error {
    public readonly statusCode?: number;
    public readonly responseBody?: unknown;

    constructor(message: string, statusCode?: number, responseBody?: unknown) {
        super(message);
        this.name = 'FlowiseError';
        this.statusCode = statusCode;
        this.responseBody = responseBody;
    }
}

export function formatFlowiseError(error: unknown): string {
    if (error instanceof FlowiseError) {
        const parts: string[] = [error.message];
        if (typeof error.statusCode === 'number') {
            parts.push(`HTTP ${error.statusCode}`);
        }
        return parts.join(' — ');
    }
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    if (error && typeof error === 'object') {
        try {
            return JSON.stringify(error);
        } catch {
            return '[unserializable error]';
        }
    }
    return String(error);
}
