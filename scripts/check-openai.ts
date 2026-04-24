// Smoke-check: работает ли OPENAI_API_KEY через наш HTTPS-прокси.
// OpenAI SDK v6 требует custom fetch с undici dispatcher — httpAgent убрали.
// Flowise preload-скрипт использует setGlobalDispatcher, но OpenAI SDK v6
// его тоже не видит (использует свой Fetch-API слой, не undici globals).
// Единственный путь — передать fetch явно в конструктор SDK.
//
// В production (slovo на Hetzner DE/FI) proxy не нужен — HTTPS_PROXY пустой,
// кастомный fetch не устанавливается, SDK использует Node native fetch.
//
// Запуск:
//   HTTPS_PROXY=http://127.0.0.1:10810 npx ts-node scripts/check-openai.ts

import 'dotenv/config';
import OpenAI from 'openai';
import { fetch as undiciFetch, ProxyAgent } from 'undici';

type TFetchFn = typeof globalThis.fetch;

function makeProxyFetch(proxyUrl: string): TFetchFn {
    const dispatcher = new ProxyAgent(proxyUrl);
    // Undici fetch и глобальный fetch имеют совместимый runtime, но разные
    // TypeScript types (undici Response vs DOM Response). Cast через unknown —
    // типобезопасно здесь, потому что runtime поведение идентично.
    return ((url: string | URL, init?: RequestInit) =>
        undiciFetch(url as Parameters<typeof undiciFetch>[0], {
            ...init,
            dispatcher,
        } as Parameters<typeof undiciFetch>[1])) as unknown as TFetchFn;
}

const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
console.log(`[check] proxy: ${proxy ?? 'disabled'}`);

if (!process.env.OPENAI_API_KEY) {
    console.error('[check] FAIL: OPENAI_API_KEY не установлен в .env');
    process.exit(1);
}

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
    fetch: proxy ? makeProxyFetch(proxy) : undefined,
});

async function main(): Promise<void> {
    console.log('[check] requesting embedding for "hello world"...');
    const started = Date.now();
    const result = await client.embeddings.create({
        model: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
        input: 'hello world',
    });
    const elapsed = Date.now() - started;

    if (!result.data[0]?.embedding) {
        console.error('[check] FAIL: empty embedding response');
        process.exit(1);
    }

    console.log(`[check] OK in ${elapsed}ms`);
    console.log(`[check] model: ${result.model}`);
    console.log(`[check] dimensions: ${result.data[0].embedding.length}`);
    console.log(`[check] tokens: ${result.usage.total_tokens}`);
    console.log(`[check] first 5 components:`, result.data[0].embedding.slice(0, 5));
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
