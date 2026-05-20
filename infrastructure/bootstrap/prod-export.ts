/**
 * Entry point — `npm run prod:export`.
 *
 * Snapshot текущего состояния Flowise (dev/staging узла) в `exports/` для git.
 *
 * Поведение — clean slate: сносит весь `exports/chatflows/`, `exports/document-stores/`,
 * `exports/variables.json` и пишет заново. Git tracks diff.
 *
 * Skeleton — full impl в [TODO infra-bootstrap-feature].
 *
 * План:
 * 1. Validate FLOWISE_API_URL + FLOWISE_API_KEY (минимально, без других env vars).
 * 2. Build `credentialIdToName` map через `buildCredentialIdToName` —
 *    для strip'инга UUID'ов в flowData chatflow'ов.
 * 3. Build `docStoreIdToName` map.
 * 4. Snapshot:
 *    - rm -rf exports/chatflows, exports/document-stores
 *    - exports/chatflows/<slug>.json = chatflow_get response с stripped UUIDs
 *      через `stripCredentialRefs` + `stripDocStoreRefs`
 *    - exports/document-stores/<slug>.json = docstore_get с stripped credential UUIDs
 *    - exports/variables.json = массив variable definitions
 * 5. Generate exports/manifest.json — sumamry с flowiseUpdatedDate per resource.
 * 6. Print summary: "Exported N chatflows + M document stores + K variables".
 *
 * После — `git diff exports/` показывает что поменялось для review.
 */

import 'dotenv/config';

async function main() {
    process.stdout.write('━━━ slovo prod export starting ━━━\n\n');
    // TODO: implement snapshot
    process.stdout.write(
        '⚠️  TODO: full implementation в скоупе prod-deployment feature.\n' +
            '   План в комментариях этого файла + infrastructure/bootstrap/README.md.\n',
    );
}

main().catch((err) => {
    process.stderr.write(`\n❌ Export failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
});
