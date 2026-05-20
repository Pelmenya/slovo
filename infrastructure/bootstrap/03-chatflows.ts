/**
 * Step 3 — Flowise Chatflows из exports/chatflows/*.json.
 *
 * Skeleton — full impl в [TODO infra-bootstrap-feature].
 *
 * План:
 * 1. Прочитать manifest.json → список .json в exports/chatflows/.
 * 2. Для каждого:
 *    - Загрузить JSON file.
 *    - Patch `{{CREDENTIAL_REF:name}}` → real UUID через `resolveCredentialRefs`.
 *    - Patch `{{DOCSTORE_REF:name}}` → real UUID через `resolveDocStoreRefs`.
 *    - ensureResource через `flowise_chatflow_create` + flowData patched.
 * 3. Visual check через Playwright рекомендован после bootstrap (см. memory
 *    `feedback_visual_check_after_chatflow_create`) — edges могут не отрисоваться
 *    если handles broken даже когда runtime отвечает.
 */

import type { FlowiseClient } from '@slovo/flowise-client';
import { logSection } from './lib/idempotent';

const SCOPE = '03-chatflows';

export async function bootstrapChatflows(
    _flowise: FlowiseClient,
    _credentialNameToId: Record<string, string>,
    _docStoreNameToId: Record<string, string>,
    _exportsDir: string,
    _forceRecreate: boolean,
): Promise<void> {
    logSection(SCOPE, 'TODO: Importing chatflows from exports/');
    // TODO:
    // - read manifest.json for chatflows list
    // - for each: load JSON, patch CREDENTIAL_REFs + DOCSTORE_REFs, chatflow_create
    // - logging: report nodeCount/edgeCount per chatflow for sanity check
}
