"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlowiseError = void 0;
exports.formatFlowiseError = formatFlowiseError;
class FlowiseError extends Error {
    statusCode;
    responseBody;
    constructor(message, statusCode, responseBody) {
        super(message);
        this.name = 'FlowiseError';
        this.statusCode = statusCode;
        this.responseBody = responseBody;
    }
}
exports.FlowiseError = FlowiseError;
function formatFlowiseError(error) {
    if (error instanceof FlowiseError) {
        const parts = [error.message];
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
        }
        catch {
            return '[unserializable error]';
        }
    }
    return String(error);
}
//# sourceMappingURL=errors.js.map