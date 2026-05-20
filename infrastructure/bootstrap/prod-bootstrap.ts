/**
 * Entry point — `npm run prod:bootstrap`.
 *
 * Поднимает Flowise конфигурацию на чистом prod-стеке:
 * 1. Validate env (fail-fast)
 * 2. Wait for Flowise ready (`/api/v1/ping`)
 * 3. Create credentials из env vars (01-credentials)
 * 4. Create document stores из exports/document-stores/ (02-document-stores)
 * 5. Create chatflows из exports/chatflows/ (03-chatflows)
 * 6. Create variables из exports/variables.json (04-variables)
 * 7. Report — что создано / переиспользовано / пропущено
 *
 * Usage:
 *   FLOWISE_API_URL=http://localhost:3130 \
 *   FLOWISE_API_KEY=... \
 *   ANTHROPIC_API_KEY=... OPENAI_API_KEY=... \
 *   POSTGRES_HOST=... ... \
 *   EU_PROXY_URL=http://eu-proxy:8888 \
 *   DEPLOYMENT_REGION=ru \
 *   npm run prod:bootstrap
 *
 * Idempotent: повторный запуск проверяет existence по name. С FORCE_RECREATE=1
 * удаляет и пересоздаёт всё (для recovery после corrupted state).
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validateBootstrapEnv } from './lib/env-validator';
import { createFlowiseClient } from './lib/flowise-client-factory';
import { bootstrapCredentials } from './01-credentials';
import { bootstrapDocumentStores } from './02-document-stores';
import { bootstrapChatflows } from './03-chatflows';
import { bootstrapVariables } from './04-variables';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPORTS_DIR = resolve(__dirname, 'exports');

async function main() {
    process.stdout.write('━━━ slovo prod bootstrap starting ━━━\n\n');

    const env = validateBootstrapEnv(process.env);
    process.stdout.write(
        `Region: ${env.deploymentRegion}, Flowise: ${env.flowiseApiUrl}, ` +
            `force-recreate: ${env.forceRecreate}\n`,
    );

    const flowise = createFlowiseClient(env);

    // Step 0 — ping Flowise (fail-fast если не достижим)
    try {
        await flowise.request('/api/v1/ping');
    } catch (error) {
        throw new Error(
            `Flowise unreachable at ${env.flowiseApiUrl}: ${error instanceof Error ? error.message : String(error)}.\n` +
                `Make sure docker compose started Flowise and it's healthy (curl ${env.flowiseApiUrl}/api/v1/ping).`,
        );
    }

    // Step 1 — credentials
    const credentials = await bootstrapCredentials(flowise, env, env.forceRecreate);

    // Step 2 — document stores
    const docStores = await bootstrapDocumentStores(
        flowise,
        credentials.nameToId,
        EXPORTS_DIR,
        env.forceRecreate,
    );

    // Step 3 — chatflows
    await bootstrapChatflows(
        flowise,
        credentials.nameToId,
        docStores.nameToId,
        EXPORTS_DIR,
        env.forceRecreate,
    );

    // Step 4 — variables
    await bootstrapVariables(flowise, EXPORTS_DIR, env.forceRecreate);

    process.stdout.write('\n━━━ Bootstrap completed ✅ ━━━\n');
    process.stdout.write(
        'Next: trigger first catalog-refresh — `docker compose exec slovo-worker npm run trigger-refresh`\n',
    );
}

main().catch((err) => {
    process.stderr.write(`\n❌ Bootstrap failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
});
