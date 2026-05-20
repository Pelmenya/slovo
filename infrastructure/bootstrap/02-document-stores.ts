/**
 * Step 2 — Flowise Document Stores из exports/document-stores/*.json.
 *
 * Skeleton — full impl в [TODO infra-bootstrap-feature].
 *
 * План:
 * 1. Прочитать manifest.json → список .json в exports/document-stores/.
 * 2. Для каждого:
 *    - Загрузить JSON file.
 *    - Patch `{{CREDENTIAL_REF:postgres-slovo-prod}}` → real UUID из credentials.nameToId.
 *    - Patch `{{CREDENTIAL_REF:openai-prod}}` для embeddings → real UUID.
 *    - `ensureResource` через `flowise_docstore_create` + `docstore_vectorstore_save`.
 * 3. Вернуть `docStoreNameToId` для следующих шагов (03-chatflows).
 *
 * Loader configurations (S3/JSON/PlainText) идут в `loaderSpec` JSON. Для
 * catalog-aquaphor — это `plainText` с loader-per-item pattern (worker
 * catalog-refresh upsертит каждый item как отдельный loader через
 * `replaceExisting=true`). Document Store config + embedding config — статика.
 */

import type { FlowiseClient } from '@slovo/flowise-client';
import { logSection } from './lib/idempotent';

const SCOPE = '02-document-stores';

export type TDocStoreBootstrapResult = {
    nameToId: Record<string, string>;
};

export async function bootstrapDocumentStores(
    _flowise: FlowiseClient,
    _credentialNameToId: Record<string, string>,
    _exportsDir: string,
    _forceRecreate: boolean,
): Promise<TDocStoreBootstrapResult> {
    logSection(SCOPE, 'TODO: Creating Flowise document stores from exports/');
    // TODO:
    // - read manifest.json for documentStores list
    // - for each: load JSON, patch CREDENTIAL_REFs, docstore_create + vectorstore_save
    // - return { nameToId }
    return { nameToId: {} };
}
