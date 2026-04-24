// Smoke-check: работает ли ANTHROPIC_API_KEY из Windows host через наш proxy.
// Если работает — для PR5 (Claude Vision) Docker не нужен, делаем локально.
// Если не работает (как OpenAI из-за TLS fingerprint) — придётся контейнеризовать.
//
// Запуск:
//   HTTPS_PROXY=http://127.0.0.1:10810 npx ts-node scripts/check-anthropic.ts

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { fetch as undiciFetch, ProxyAgent } from 'undici';

type TFetchFn = typeof globalThis.fetch;

function makeProxyFetch(proxyUrl: string): TFetchFn {
    const dispatcher = new ProxyAgent(proxyUrl);
    return ((url: string | URL, init?: RequestInit) =>
        undiciFetch(url as Parameters<typeof undiciFetch>[0], {
            ...init,
            dispatcher,
        } as Parameters<typeof undiciFetch>[1])) as unknown as TFetchFn;
}

const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
console.log(`[check] proxy: ${proxy ?? 'disabled'}`);

if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[check] FAIL: ANTHROPIC_API_KEY не установлен в .env');
    process.exit(1);
}

const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    fetch: proxy ? makeProxyFetch(proxy) : undefined,
});

async function main(): Promise<void> {
    console.log('[check] requesting short message from claude-haiku-4-5...');
    const started = Date.now();
    const result = await client.messages.create({
        model: process.env.ANTHROPIC_FAST_MODEL ?? 'claude-haiku-4-5',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Ответь одним словом: "работаю".' }],
    });
    const elapsed = Date.now() - started;

    const textBlock = result.content.find((b) => b.type === 'text');
    console.log(`[check] OK in ${elapsed}ms`);
    console.log(`[check] model: ${result.model}`);
    console.log(`[check] stop_reason: ${result.stop_reason}`);
    console.log(`[check] input tokens: ${result.usage.input_tokens}`);
    console.log(`[check] output tokens: ${result.usage.output_tokens}`);
    console.log(`[check] response: ${textBlock && textBlock.type === 'text' ? textBlock.text : '???'}`);
}

main().catch((err: unknown) => {
    if (err && typeof err === 'object' && 'status' in err) {
        const anyErr = err as { status?: number; message?: string };
        console.error(`[check] FAIL: HTTP ${anyErr.status ?? '?'} — ${anyErr.message ?? ''}`);
    } else if (err instanceof Error) {
        console.error(`[check] FAIL: ${err.message}`);
    } else {
        console.error('[check] FAIL:', err);
    }
    process.exit(1);
});
