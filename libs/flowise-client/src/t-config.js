"use strict";
// =============================================================================
// Конфиг FlowiseClient — передаётся в конструктор. Apps (mcp-flowise / worker /
// api) сами валидируют env и собирают TFlowiseClientConfig из своих source'ов.
// Lib не знает про process.env / dotenv / NestJS ConfigService — direction
// зависимостей чистый (apps → libs).
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MAX_RETRIES = exports.DEFAULT_THROTTLE_MS = exports.DEFAULT_REQUEST_TIMEOUT_MS = void 0;
exports.DEFAULT_REQUEST_TIMEOUT_MS = 30000;
exports.DEFAULT_THROTTLE_MS = 50;
exports.DEFAULT_MAX_RETRIES = 3;
//# sourceMappingURL=t-config.js.map