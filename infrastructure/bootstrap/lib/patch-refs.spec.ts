import {
    stripCredentialRefs,
    stripDocStoreRefs,
    resolveCredentialRefs,
    resolveDocStoreRefs,
} from './patch-refs';

describe('stripCredentialRefs', () => {
    it('replaces quoted UUID с {{CREDENTIAL_REF:name}}', () => {
        const json = '{"credential":"d5e595c0-e03e-4d9e-9fc1-1595bbc3ba99"}';
        const idToName = { 'd5e595c0-e03e-4d9e-9fc1-1595bbc3ba99': 'anthropic-prod' };
        const result = stripCredentialRefs(json, idToName);
        expect(result).toBe('{"credential":"{{CREDENTIAL_REF:anthropic-prod}}"}');
    });

    it('replaces multiple occurrences of same UUID', () => {
        const json =
            '{"a":"d5e595c0-e03e-4d9e-9fc1-1595bbc3ba99","b":"d5e595c0-e03e-4d9e-9fc1-1595bbc3ba99"}';
        const idToName = { 'd5e595c0-e03e-4d9e-9fc1-1595bbc3ba99': 'anthropic-prod' };
        const result = stripCredentialRefs(json, idToName);
        expect(result).toMatch(/"{{CREDENTIAL_REF:anthropic-prod}}"/);
        expect(result).not.toMatch(/d5e595c0-/);
    });

    it('handles multiple different credentials in same JSON', () => {
        const json = '{"a":"uuid-1","b":"uuid-2"}';
        const idToName = { 'uuid-1': 'anthropic-prod', 'uuid-2': 'openai-prod' };
        const result = stripCredentialRefs(json, idToName);
        expect(result).toBe(
            '{"a":"{{CREDENTIAL_REF:anthropic-prod}}","b":"{{CREDENTIAL_REF:openai-prod}}"}',
        );
    });

    it('leaves JSON untouched when no UUIDs match map', () => {
        const json = '{"name":"DWM-101S","price":1690000}';
        const idToName = { 'd5e595c0-e03e-4d9e-9fc1-1595bbc3ba99': 'anthropic-prod' };
        expect(stripCredentialRefs(json, idToName)).toBe(json);
    });

    it('does NOT replace unquoted UUID (avoid corrupting non-credential refs)', () => {
        const json = '{"text":"some text d5e595c0-... mentioned"}';
        const idToName = { 'd5e595c0-e03e-4d9e-9fc1-1595bbc3ba99': 'anthropic-prod' };
        // UUID не в кавычках → не trigger'ит replace
        expect(stripCredentialRefs(json, idToName)).toBe(json);
    });
});

describe('stripDocStoreRefs', () => {
    it('replaces DocStore UUID с placeholder', () => {
        const json = '{"selectedStore":"aec6b741-8610-4f98-9f5c-bc829dc41a96"}';
        const idToName = { 'aec6b741-8610-4f98-9f5c-bc829dc41a96': 'catalog-aquaphor' };
        const result = stripDocStoreRefs(json, idToName);
        expect(result).toBe('{"selectedStore":"{{DOCSTORE_REF:catalog-aquaphor}}"}');
    });
});

describe('resolveCredentialRefs', () => {
    it('replaces {{CREDENTIAL_REF:name}} с real UUID', () => {
        const json = '{"credential":"{{CREDENTIAL_REF:anthropic-prod}}"}';
        const nameToId = { 'anthropic-prod': 'new-uuid-aaa' };
        expect(resolveCredentialRefs(json, nameToId)).toBe('{"credential":"new-uuid-aaa"}');
    });

    it('replaces multiple different placeholders', () => {
        const json =
            '{"a":"{{CREDENTIAL_REF:anthropic-prod}}","b":"{{CREDENTIAL_REF:openai-prod}}"}';
        const nameToId = { 'anthropic-prod': 'uuid-a', 'openai-prod': 'uuid-b' };
        const result = resolveCredentialRefs(json, nameToId);
        expect(result).toBe('{"a":"uuid-a","b":"uuid-b"}');
    });

    it('throws when placeholder references missing credential', () => {
        const json = '{"credential":"{{CREDENTIAL_REF:gemini}}"}';
        const nameToId = { 'anthropic-prod': 'uuid-a' };
        expect(() => resolveCredentialRefs(json, nameToId)).toThrow(
            /missing credential "gemini"/,
        );
    });

    it('error message lists available credentials for debug', () => {
        const json = '{"credential":"{{CREDENTIAL_REF:gemini}}"}';
        const nameToId = { 'anthropic-prod': 'uuid-a', 'openai-prod': 'uuid-b' };
        expect(() => resolveCredentialRefs(json, nameToId)).toThrow(
            /Available credentials: \[anthropic-prod, openai-prod\]/,
        );
    });

    it('leaves JSON untouched when no placeholders present', () => {
        const json = '{"name":"DWM-101S"}';
        expect(resolveCredentialRefs(json, {})).toBe(json);
    });
});

describe('resolveDocStoreRefs', () => {
    it('replaces {{DOCSTORE_REF:name}} с real UUID', () => {
        const json = '{"selectedStore":"{{DOCSTORE_REF:catalog-aquaphor}}"}';
        const nameToId = { 'catalog-aquaphor': 'new-docstore-uuid' };
        expect(resolveDocStoreRefs(json, nameToId)).toBe(
            '{"selectedStore":"new-docstore-uuid"}',
        );
    });

    it('throws when placeholder references missing docstore', () => {
        const json = '{"selectedStore":"{{DOCSTORE_REF:unknown-store}}"}';
        expect(() => resolveDocStoreRefs(json, {})).toThrow(/missing document store/);
    });
});

describe('strip → resolve round-trip', () => {
    it('strip + resolve returns equivalent UUID structure (with possibly different UUIDs)', () => {
        const original =
            '{"data":{"credential":"d5e595c0-e03e-4d9e-9fc1-1595bbc3ba99","selectedStore":"aec6b741-8610-4f98-9f5c-bc829dc41a96"}}';

        // Export step
        const credIdToName = { 'd5e595c0-e03e-4d9e-9fc1-1595bbc3ba99': 'anthropic-prod' };
        const docStoreIdToName = { 'aec6b741-8610-4f98-9f5c-bc829dc41a96': 'catalog-aquaphor' };
        const stripped = stripDocStoreRefs(
            stripCredentialRefs(original, credIdToName),
            docStoreIdToName,
        );
        expect(stripped).toContain('{{CREDENTIAL_REF:anthropic-prod}}');
        expect(stripped).toContain('{{DOCSTORE_REF:catalog-aquaphor}}');

        // Bootstrap step on prod — UUIDs новые
        const newCredMap = { 'anthropic-prod': 'PROD-CRED-UUID' };
        const newDocStoreMap = { 'catalog-aquaphor': 'PROD-STORE-UUID' };
        const resolved = resolveDocStoreRefs(
            resolveCredentialRefs(stripped, newCredMap),
            newDocStoreMap,
        );

        expect(resolved).toBe(
            '{"data":{"credential":"PROD-CRED-UUID","selectedStore":"PROD-STORE-UUID"}}',
        );
    });
});
