/**
 * FlowiseClient factory для bootstrap scripts.
 *
 * Re-use @slovo/flowise-client из libs/ с увеличенным timeout — re-embed Document
 * Store на 155+ items может занять минуты (см. REFRESH_FLOWISE_TIMEOUT_MS в
 * catalog-refresh.module.ts).
 */

import { FlowiseClient } from '@slovo/flowise-client';
import type { TBootstrapEnv } from './env-validator';

/** 5 минут — потолок для любой одиночной Flowise операции. */
const BOOTSTRAP_FLOWISE_TIMEOUT_MS = 300_000;

export function createFlowiseClient(env: TBootstrapEnv): FlowiseClient {
    return new FlowiseClient({
        apiUrl: env.flowiseApiUrl,
        apiKey: env.flowiseApiKey,
        requestTimeoutMs: BOOTSTRAP_FLOWISE_TIMEOUT_MS,
    });
}
