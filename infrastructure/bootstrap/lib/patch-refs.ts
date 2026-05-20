/**
 * Patch credential/docStore UUID references при export → git → bootstrap workflow.
 *
 * Flowise хранит references как UUID'ы в JSON ноды (например,
 * `data.credential = "d5e595c0-..."` или `vectorStoreConfig.config.credential`).
 * При экспорте на dev узле UUID'ы соответствуют **dev** credentials. На prod
 * узле UUID'ы будут **новые** (другая Flowise sqlite/DB instance).
 *
 * Решение — strip UUID'ы при export → заменяем placeholder'ом
 * `{{CREDENTIAL_REF:<credentialName>}}`, при bootstrap → resolve по name-lookup
 * из nameToIdMap созданных credentials.
 *
 * Аналогично для DocumentStoreVS ноды → `selectedStore: "<docstore-uuid>"` →
 * `{{DOCSTORE_REF:<docstoreName>}}`.
 */

import type { FlowiseClient } from '@slovo/flowise-client';

// Pattern включает surrounding quotes — symmetric с stripCredentialRefs которая
// strips quoted UUIDs ("uuid" → "{{CREDENTIAL_REF:name}}"). Replace на "${id}"
// сохраняет JSON validity.
const CREDENTIAL_REF_PATTERN = /"\{\{CREDENTIAL_REF:([^}]+)\}\}"/g;
const DOCSTORE_REF_PATTERN = /"\{\{DOCSTORE_REF:([^}]+)\}\}"/g;

export type TNameToIdMap = Record<string, string>;

// =============================================================================
// EXPORT: live UUID → placeholder
// =============================================================================

/**
 * Stripped UUID references → placeholder для git-safe экспорта.
 *
 * Аргумент `credentialIdToName` — обратный map (`uuid → name`), потому что
 * в flowData мы видим UUID и нужно резолвить в имя credential для placeholder.
 */
export function stripCredentialRefs(
    flowDataJson: string,
    credentialIdToName: TNameToIdMap,
): string {
    let result = flowDataJson;
    for (const [uuid, name] of Object.entries(credentialIdToName)) {
        // Quoted UUID в JSON: "d5e595c0-..." → "{{CREDENTIAL_REF:anthropic-prod}}"
        const quoted = `"${uuid}"`;
        const placeholder = `"{{CREDENTIAL_REF:${name}}}"`;
        result = result.split(quoted).join(placeholder);
    }
    return result;
}

export function stripDocStoreRefs(
    flowDataJson: string,
    docStoreIdToName: TNameToIdMap,
): string {
    let result = flowDataJson;
    for (const [uuid, name] of Object.entries(docStoreIdToName)) {
        const quoted = `"${uuid}"`;
        const placeholder = `"{{DOCSTORE_REF:${name}}}"`;
        result = result.split(quoted).join(placeholder);
    }
    return result;
}

// =============================================================================
// BOOTSTRAP: placeholder → newly created UUID
// =============================================================================

/**
 * Resolve placeholder → real UUID из nameToIdMap созданных credentials.
 *
 * Падаем если placeholder ссылается на credential которого нет в map — это
 * прецедент рассинхрона между export'ом и bootstrap'ом (например, в exports/
 * есть chatflow с `anthropic-prod` ref, но 01-credentials.ts не создал такой).
 */
export function resolveCredentialRefs(
    flowDataJson: string,
    nameToId: TNameToIdMap,
): string {
    return flowDataJson.replace(CREDENTIAL_REF_PATTERN, (match, name: string) => {
        const id = nameToId[name];
        if (!id) {
            throw new Error(
                `resolveCredentialRefs: placeholder "${match}" references missing credential "${name}". ` +
                    `Available credentials: [${Object.keys(nameToId).join(', ')}]. ` +
                    `Check 01-credentials.ts created this credential.`,
            );
        }
        return `"${id}"`;
    });
}

export function resolveDocStoreRefs(
    flowDataJson: string,
    nameToId: TNameToIdMap,
): string {
    return flowDataJson.replace(DOCSTORE_REF_PATTERN, (match, name: string) => {
        const id = nameToId[name];
        if (!id) {
            throw new Error(
                `resolveDocStoreRefs: placeholder "${match}" references missing document store "${name}". ` +
                    `Available document stores: [${Object.keys(nameToId).join(', ')}]. ` +
                    `Check 02-document-stores.ts created this store.`,
            );
        }
        return `"${id}"`;
    });
}

// =============================================================================
// Helpers — построение idToName mapping из live Flowise
// =============================================================================

export async function buildCredentialIdToName(flowise: FlowiseClient): Promise<TNameToIdMap> {
    type TCredentialListItem = { id: string; name: string };
    const credentials = await flowise.request<TCredentialListItem[]>('/api/v1/credentials');
    const map: TNameToIdMap = {};
    for (const c of credentials) {
        map[c.id] = c.name;
    }
    return map;
}

export async function buildDocStoreIdToName(flowise: FlowiseClient): Promise<TNameToIdMap> {
    type TDocStoreListItem = { id: string; name: string };
    const stores = await flowise.request<TDocStoreListItem[]>('/api/v1/document-store/store');
    const map: TNameToIdMap = {};
    for (const s of stores) {
        map[s.id] = s.name;
    }
    return map;
}
