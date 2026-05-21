# Phase 0 v2 — Real-source merge: algorithm + change detection

> **Дата:** 2026-05-21 (после Phase 0 v1 failed gate).
> **Цель:** заменить hardcoded PoC chunks (Step 6.5) на merge от **источников правды**. Параллельно — определить алгоритм инкрементального обновления при добавлении/изменении ERP товаров или PDF паспортов.
> **Контекст:** [Phase 0 v1 report](2026-05-21-phase-0-gold-poc.md) — gate failed +0.0pp, root cause = bad PoC data quality (цены в metadata вместо text + unverified anti-confusion footers).

---

## Sources of truth (3)

| Source | Path | Что содержит | Change signal |
|---|---|---|---|
| **ERP catalog** | MinIO `slovo-datasets/catalogs/aquaphor/latest.json` | 154 items × `{externalId, name, salePriceKopecks, productCategory, contentForEmbedding, relatedServices, relatedComponents, contentHash}` | `item.contentHash` (sha256 per item) + `latest.json metadata.contenthash` (всего snapshot'а) |
| **ERP vision augmentation** | Redis HASH `slovo:catalog:vision-augment` | 152 fields × `{imageHash, visualDescription, modelVersion}` per `externalId`. Генерится `vision-augmenter.service.ts` через chatflow `catalog-vision-augmenter-v1` (Haiku 4.5 vision) при `catalog-refresh` worker run | `imageHash` + `modelVersion` |
| **PDF specs** | MinIO `slovo-datasets/specs/aquaphor/<group>/<filename>.json` + manifest `specs/aquaphor/latest.json` | 226 docling-output × `{filename, group, modelCodes, modelType, technologyTags, sections[]}`. Sections: `tech_specs / package_contents / compatible_cartridges / cartridge_replacement_schedule / warranty / narrative_purpose`. Static между docling runs — обновляется only при re-extraction PDF. | Per-file `sha256` в S3 Object metadata + aggregate в manifest `latest.json`. Manifest sha256 в S3 Object metadata позволяет HEAD-check без full download. |

**НЕ источник правды:**
- `catalog-aquaphor` Document Store — это **derived** representation (после catalog-refresh ingest). Build-time merge gold идёт от ERP+vision+specs raw, **не** от уже chunked catalog-aquaphor.
- `catalog-aquaphor-specs` Document Store — то же самое, derived из specs/*.json.

**Vision на PDF:** docling **не извлекает** pictures из паспортов в JSON (нет section type `picture_*`). Схемы установки / цветовая кодировка модулей / диаграммы — теряются. Для gold v2 это **known gap** — добавляется не сейчас, потенциально через docling-картинки pipeline отдельной фазой.

---

## Matching algorithm — SKU → PDF specs

PDF паспорта разбросаны по 10 категориям папок (`ro_system/`, `softener/`, `accessory/`, `cartridge/`, `pre_filter/`, `housing/`, `flow_filter/`, `pitcher/`, `instruction_other/`, `other_product/`). У одной модели может быть **0..N PDF** в разных местах:

- Системы (DWM-101S) — обычно 2-3 PDF: instruction + spec sheet + combined-models brochure
- Смесители (C125, C126, 82138C) — отдельный PDF в `accessory/`
- Cartridges (КО-50S, КО-100S) — **обычно** собственного PDF **нет**, упоминаются в `package_contents` системного PDF

### 3-уровневый matching

**Уровень 1 — primary match через `modelCodes` array в spec JSON:**

```js
const SKU_ALIASES = {
    'DWM-101S':       ['DWM-101S', 'DWM-101SN', 'DWM-101'],          // 3 PDF
    'DWM-102S Pro':   ['DWM-102S Pro', 'DWM-102SN PRO'],
    'DWM-202S-C':     ['DWM-202S-C', 'DWM-202S'],
    'DWM-202S-C-LD':  ['DWM-202S-C-LD', 'DWM-202SN_PRO'],
    'OSMO Pro 50':    ['OSMO Pro 50', 'APRO-100'],
    'WS500':          ['WS500', 'WS500 P1'],
    'WS800':          ['WS800', 'WS800 P1'],
    'WS1000':         ['WS1000', 'WS1000 P1', 'WS1000_A'],
    'C125':           ['C125', 'С125'],     // homoglyph: latin C vs cyrillic С
    'C126':           ['C126', 'С126'],
    '82138C':         ['82138C', '82138С'],
    'КО-50S':         ['КО-50S'],            // вероятно fallback на cartridge level
    'КО-100S':        ['КО-100S'],
};

const norm = s => s.toLowerCase().replace(/\s+/g, '').replace(/[-_]/g, '');

function findSpecsByModelCode(sku, allSpecs) {
    const normAliases = (SKU_ALIASES[sku] || [sku]).map(norm);
    return allSpecs.filter(s =>
        (s.modelCodes || []).some(m => normAliases.includes(norm(m)))
    );
}
```

**Уровень 2 — fallback для cartridges через `sections[].data` scan:**

КО-50S / КО-100S и подобные модули обычно не имеют отдельного PDF. Scan всех specs на substring SKU в `package_contents` / `cartridge_replacement_schedule` секциях:

```js
const CARTRIDGE_SKUS = ['КО-50S', 'КО-100S', 'К5', 'К2', 'К7М', 'Pro 1', 'Pro 2', 'Pro 100', 'Pro BMg'];

function findSpecsByCartridgeMention(sku, allSpecs) {
    const needle = norm(sku);
    return allSpecs.filter(s =>
        (s.sections || [])
            .filter(sec => sec.type === 'package_contents' || sec.type === 'cartridge_replacement_schedule')
            .some(sec => JSON.stringify(sec.data || {}).toLowerCase().includes(needle))
    ).map(s => ({
        // Возвращаем only the cartridge-relevant sections, not the whole PDF
        ...s,
        sections: s.sections.filter(sec => JSON.stringify(sec.data || {}).toLowerCase().includes(needle))
    }));
}
```

**Уровень 3 — manual override mapping:**

Для edge cases где modelCodes не совпадают точно с canonical SKU (e.g. PDF labeled `DWM-101` а каталог имеет `DWM-101S`) — explicit table в коде:

```js
const MANUAL_SKU_PDF_MAP = {
    'OSMO Pro 50': ['ro_system/APRO-100_19-12-2023.pdf.json'],   // APRO ≈ OSMO Pro в old naming
};
```

### Master matching function

```js
function findSpecsForSku(sku, allSpecs) {
    // Tier 1: modelCodes match
    let matched = findSpecsByModelCode(sku, allSpecs);
    
    // Tier 3 override merge in
    const manual = (MANUAL_SKU_PDF_MAP[sku] || []).map(path => allSpecs.find(s => s.filename === path)).filter(Boolean);
    matched = [...matched, ...manual];
    
    // Tier 2 fallback only if Tier 1+3 пусто И SKU выглядит как cartridge
    if (matched.length === 0 && CARTRIDGE_SKUS.includes(sku)) {
        matched = findSpecsByCartridgeMention(sku, allSpecs);
    }
    
    // Deduplicate by filename
    const seen = new Set();
    return matched.filter(s => seen.has(s.filename) ? false : (seen.add(s.filename), true));
}
```

### Behavior при 0 matches

Specs chunk **не создаётся** для этого SKU. В metadata catalog chunk флаг `hasSpecs: false` → AI знает «отдельного tech-паспорта нет» и не fabricate. Соответствующая generation rule в system prompt.

### Multi-PDF merge при N > 1

Specs chunk собирается из всех matched PDF с явной source attribution:

```
## <SKU> — Технический паспорт

### Источники
- DWM-101_instruction.pdf (instruction guide)
- dwm101-102S_v6_print.pdf (combined spec sheet)
- DWM-101SN_v2.pdf (spec sheet v2)

### Технические характеристики
[merged tech_specs sections, дедуплицированные по полям]

### Комплект поставки
[merged package_contents, разделитель --- между источниками]
...
```

**При противоречии** между PDF (например v2 имеет updated specs vs v1) — оба включаются с явным sourcing. Это **намеренная** избыточность для retrieve — LLM получает оба варианта + source, не приходится gold worker'у решать какой «более актуальный». Если в будущем потребуется dedup — отдельная фаза (LLM-based reconciliation per Альтернатива F/G в ADR-010).

## SKU canonicalization

Один SKU (например DWM-101S) маппится в:
- **N ERP items** в `latest.json` — basic вариант + bundle варианты с разными ценами:
  - `Аквафор DWM-101S` — 16 900 ₽ (basic)
  - `... DWM-101S (без крана) + Смеситель С125` — 25 980 ₽
  - `... DWM-101S (без крана) + Смеситель С126` — 22 980 ₽
  - `Умягчитель WS500 (Si) + подарок DWM-101SN` — 74 990 ₽ (DWM как promo, не main)
- **M PDF specs** в `specs/` — у одной модели может быть несколько паспортов разных годов / версий

Match algorithm:
- **ERP → SKU**: regex по `name` с **homoglyph normalization** (русская «С» ↔ латинская «C» в смесителях; «КО-50S» case-insensitive). Bundle items где SKU как promo (не main product) — относим к **main product**, не к promo SKU.
- **PDF → SKU**: `modelCodes` array точное совпадение (нормализация case + пробелы).
- **Reverse direction also**: SKU → set of matched ERP items + set of matched PDF files.

---

## Chunking strategy — tematic per SKU

**Один SKU → 3 chunks** организованных по теме:

### Chunk A: `<SKU> — Каталог Аквафор-Pro`
```
## <SKU>

### Бренд / категория
Brand: Аквафор / категория: <productCategory>

### Варианты в наличии

#### <bundle 1 name> — <price 1> ₽ (артикул <externalId 1>)
<contentForEmbedding bundle 1>
**Визуальное описание:** <visualDescription bundle 1>

#### <bundle 2 name> — <price 2> ₽ (артикул <externalId 2>)
<contentForEmbedding bundle 2>
...
```

**Embedding обучается на**: цены / варианты bundle / артикулы / общее визуальное описание.

### Chunk B: `<SKU> — Технический паспорт`
```
## <SKU> — техническая документация

### Источник
<filenames of merged specs PDF>

### Технические характеристики
<sections type=tech_specs>

### Комплект поставки
<sections type=package_contents>

### Совместимость
<sections type=compatible_cartridges>

### Сроки службы / регламент замены
<sections type=cartridge_replacement_schedule>

### Назначение
<sections type=narrative_purpose>

### Гарантия
<sections type=warranty>
```

**Embedding обучается на**: производительность / давление / совместимость / срок службы.

### Chunk C: `<SKU> — Расходники и услуги`
```
## <SKU> — расходники, замены, услуги

### Расходники (по данным ERP)
<from relatedComponents — каждый компонент с название, ценой, периодичностью замены если есть>

### Услуги (по данным ERP)
<from relatedServices — установка, замена картриджей, диагностика, цены если есть>
```

**Embedding обучается на**: сменные модули / стоимость замены / услуги монтажа.

### Metadata на каждом chunk

```typescript
{
    sku: "DWM-101S",
    section: "catalog" | "specs" | "service",
    erpItemsIncluded: ["<externalId-1>", "<externalId-2>", ...],   // только в catalog chunk
    specsFilesIncluded: ["DWM-101SN_v2.pdf", ...],                  // только в specs chunk
    chunkHash: "<sha256 of text>",
    sourcesHashes: {
        erpItems: { "<externalId-1>": "<contentHash>", ... },
        visionAugment: { "<externalId-1>": "<imageHash:modelVersion>", ... },
        specsFiles: { "<filename>": "<sha256>", ... },
    },
    builtAt: "<ISO timestamp>",
}
```

Размеры expected:
- catalog chunk: ~2000-3500 chars (с 2-3 bundles и vision)
- specs chunk: ~2500-4000 chars (если паспорт rich)
- service chunk: ~500-1500 chars

Splitter `chunkSize=4096, chunkOverlap=0` — чанки помещаются в один без split в подавляющем большинстве. Если specs очень rich (Акваэффект ~5500 chars) — split на 2.

---

## Match: 13 SKU → ERP items + specs files

Mapping table для Phase 0 v2 (manual seed):

| SKU canonical | ERP name pattern | specs modelCodes | category |
|---|---|---|---|
| DWM-101S | `Аквафор DWM-101S(?!N)` (basic + bundle с С125/С126) | `DWM-101S` или `DWM-101SN` | ro_system |
| DWM-102S Pro | `Аквафор DWM-102S Pro` | `DWM-102S Pro` | ro_system |
| DWM-202S-C | `Аквафор DWM-202S-C(?!-LD)` | `DWM-202S` или `DWM-202S-C` | ro_system |
| DWM-202S-C-LD | `Автомат питьевой воды Аквафор DWM-202S-C-LD` | `DWM-202S-C-LD` (или from specs `DWM-202SN PRO`) | ro_system |
| OSMO Pro 50 | `Водоочиститель Аквафор OSMO Pro 50` | `OSMO Pro 50` | ro_system |
| WS500 | `Умягчитель Аквафор WS500` | `WS500` | softener |
| WS800 | `Умягчитель Аквафор WS800` | `WS800` | softener |
| WS1000 | `Умягчитель Аквафор WS1000` | `WS1000` | softener |
| C125 | `Смеситель кухонный модель С125` (русская С) | `C125` | accessory |
| C126 | `Смеситель кухонный модель С126` | `C126` | accessory |
| 82138C | `Смеситель кухонный модель 82138С` | `82138C` | accessory |
| КО-50S | `Модуль сменный мембранный КО-50S` | `КО-50S` (если есть отдельный PDF) | cartridge |
| КО-100S | `Модуль сменный мембранный КО-100S` | `КО-100S` (если есть отдельный PDF) | cartridge |

---

## Retrieve strategy при tematic chunking

При 3-chunks-per-SKU retrieve K=3 single-DS теперь может вернуть **все 3 chunks одной модели**, а не chunks от 6 SKU как в 2-DS architecture (K=3 × 2 stores). Для multi-SKU queries («сравни DWM-101S и DWM-102S Pro») этого может не хватить.

**Стратегия для Phase 0 v2 measurement:**

1. **Default K=3** на gold DS — baseline для сравнения с existing 2-DS K=3+3=6.
2. **Замерить recall@K на multi-SKU queries** в smoke (S13 «DWM-101S vs DWM-202S-C», S30 «самый крутой осмос», G4 «DWM-202S-C vs DWM-202S-C-LD») — отдельная метрика в Phase 0 v2 report.
3. **Если recall падает** на multi-SKU queries (т.е. AI забывает второй SKU из вопроса) — **bump K=6 или K=9** в новой ревизии chatflow (v2.1), не правим v2. Re-smoke.

**Альтернативы для Phase 1+** (если K=6+ не решает):

- **Per-section retrieve** — `mmrLambda` параметр vectorstore или multi-query strategy: один retrieve по «catalog», один по «specs», один по «service», склейка top-K из каждой category. Требует chatflow modification (multi-retriever pattern).
- **Pre-classification query type** — если AI agent классифицирует query как «compare» vs «specific» vs «list» — динамически выбирает K. Усложнение.
- **Metadata filter** — retrieve с filter `section=catalog` для price queries, `section=specs` для tech queries. Требует query understanding в chatflow.

Решение между этими — после Phase 0 v2 measurement.

## Change detection — incremental merge algorithm

### State (Redis HASH `slovo:catalog-merge:state`)

Field per SKU:
```json
{
    "sku": "DWM-101S",
    "lastBuildAt": "2026-05-21T14:00:00Z",
    "chunks": {
        "catalog": { "docId": "<flowise>", "chunkHash": "<sha256>" },
        "specs":   { "docId": "<flowise>", "chunkHash": "<sha256>" },
        "service": { "docId": "<flowise>", "chunkHash": "<sha256>" }
    },
    "sourcesHashes": {
        "erpItems": { "<externalId>": "<contentHash>", ... },
        "visionAugment": { "<externalId>": "<imageHash:modelVersion>", ... },
        "specsFiles": { "<filename>": "<sha256>", ... }
    }
}
```

### Merge run (pseudocode)

```typescript
async function rebuildGoldDS() {
    // 1. Load sources
    const erpSnapshot = await loadLatestJsonFromMinio();       // 154 items
    const visionMap = await loadVisionAugmentFromRedis();      // 152 fields
    const specsFiles = await scanSpecsFolder();                // 224 JSON
    const state = await loadMergeState();                      // per-SKU current hashes

    // 2. Iterate canonical SKUs
    for (const sku of CANONICAL_SKUS) {
        const erpItems = matchErpItems(sku, erpSnapshot);
        const specsForSku = matchSpecs(sku, specsFiles);

        // 3. Compute current source hashes
        const currentHashes = {
            erpItems: Object.fromEntries(erpItems.map(i => [i.externalId, i.contentHash])),
            visionAugment: Object.fromEntries(erpItems.map(i => {
                const v = visionMap[i.externalId];
                return [i.externalId, v ? `${v.imageHash}:${v.modelVersion}` : 'none'];
            })),
            specsFiles: Object.fromEntries(await Promise.all(
                specsForSku.map(async f => [f.filename, await sha256File(f.path)])
            )),
        };

        // 4. Skip if source hashes match stored
        if (state[sku] && deepEqual(state[sku].sourcesHashes, currentHashes)) {
            log('skip', sku, 'unchanged');
            continue;
        }

        // 5. Build 3 thematic chunks
        const chunks = {
            catalog: buildCatalogChunk(sku, erpItems, visionMap),
            specs:   buildSpecsChunk(sku, specsForSku),
            service: buildServiceChunk(sku, erpItems),
        };

        // 6. For each chunk: skip if chunkHash unchanged, otherwise upsert
        for (const [section, text] of Object.entries(chunks)) {
            const chunkHash = sha256(text);
            const stored = state[sku]?.chunks?.[section];
            if (stored?.chunkHash === chunkHash) {
                log('chunk-skip', sku, section);
                continue;
            }
            const docId = stored?.docId;   // re-use if exists for replaceExisting
            const response = await flowiseUpsert({
                storeId: GOLD_STORE_ID,
                loader: { name: 'plainText', config: { text, metadata: JSON.stringify(buildMetadata(sku, section, ...)) } },
                splitter: { name: 'recursiveCharacterTextSplitter', config: { chunkSize: 4096, chunkOverlap: 0 } },
                vectorStore: GOLD_VECTORSTORE_CONFIG,
                embedding: GOLD_EMBEDDING_CONFIG,
                docId,
                replaceExisting: docId !== undefined,
            });
            chunks[section] = { docId: response.docId, chunkHash };
        }

        // 7. Save state
        await saveMergeState(sku, { lastBuildAt: now(), chunks, sourcesHashes: currentHashes });
    }

    // 8. REMOVED sweep: SKU which был в state но больше нет в canonical/sources
    for (const storedSku of Object.keys(state)) {
        if (!CANONICAL_SKUS.includes(storedSku)) {
            for (const section of ['catalog', 'specs', 'service']) {
                await flowiseDeleteLoader(GOLD_STORE_ID, state[storedSku].chunks[section].docId);
            }
            await deleteMergeState(storedSku);
        }
    }
}
```

### Event handling

| Event | Detection | Action |
|---|---|---|
| **New ERP item** | `erpItems[i].externalId` not in stored `sourcesHashes.erpItems` | catalog + service chunks re-merge для SKU |
| **ERP price change** | `erpItems[i].contentHash` ≠ stored | catalog + service chunks re-merge для SKU |
| **ERP item deleted** | `externalId` в stored но не в current | catalog + service chunks re-merge (без этого item) |
| **Vision augment updated** | `visionAugment[id].imageHash` ≠ stored OR `modelVersion` bumped | catalog chunk re-merge (vision только там) |
| **New PDF** | `specsFiles[f].filename` not in stored | specs chunk re-merge для всех затронутых SKU |
| **PDF updated** | `sha256(file)` ≠ stored | specs chunk re-merge для всех затронутых SKU |
| **PDF удалён** | `filename` в stored но не на диске | specs chunk re-merge (без этого file) |
| **Canonical SKU список изменился** | `CANONICAL_SKUS` коммит/конфиг update | новый SKU → fresh chunks; removed SKU → REMOVED sweep |

### Когда запускать

**Phase 0 v2:** ручной `node experiments/specs-enrichment/upsert-real-merge-to-gold.mjs`. Без cron, без Redis state — Phase 0 это measurement, не production worker.

**Phase 1+ (если decision positive):** `@Cron('30 4 * * *')` в `apps/worker/src/modules/catalog-merge/`, downstream от catalog-refresh (он завершается на 0 4). Redis state как описано выше. См. catalog-merge feature plan.

---

## Trade-off дискуссия — почему tematic chunks (variant C)

Рассматривал три варианта chunking:

| Variant | Pros | Cons | Verdict |
|---|---|---|---|
| **A: 1 chunk per модель** (полный merge) | Single source of truth для каждой модели; LLM получает всю информацию одним retrieve | Chunk превышает 4096 chars (DWM-101S × 8 bundles + vision + specs ≈ 17000 chars) → splitter режет → каждый chunk теряет coherence; embedding учится на «среднем» из множества тем — semantic similarity размывается | ❌ |
| **B: 1 chunk per ERP item** (bundle SKU) | Гранулярно — точный retrieve по bundle | Дублирует existing catalog-aquaphor pattern (не gain от gold); specs дублируется во всех 8 bundle chunks DWM-101S — wasted embedding cost | ❌ |
| **C: Tematic per SKU** (3 chunks: catalog/specs/service) | Adaptive retrieve — вопрос про цену → catalog chunk, про тех → specs chunk; embedding тренируется на coherent topic; точечный re-embed при partial change (price change → только catalog, не specs) | Сложнее merge logic; нужно решать что куда положить | ✅ |

**Главный аргумент за C:** ERP-данные и Tech-specs семантически разные топики. Если их в одном embedding — vector «среднее» теряет точность поиска. В отдельных embedding каждый специализирован → retrieval recall выше.

**Bonus:** при изменении только цены в ERP — re-embed только catalog chunk (1 из 3). Cost ↓ для production-runs.

---

## Уроки от Phase 0 v1, учтённые в v2

1. ✅ **Цена в text, не metadata** — берём `contentForEmbedding` целиком (там цена напрямую).
2. ✅ **Без хардкод anti-confusion footers** — никаких «помню что цена X». Только source data.
3. ✅ **Vision augmentation учтена** — vision-augment Redis HASH inject'ится в catalog chunk per bundle.
4. ✅ **Splitter chunk_size совместим** — tematic chunks остаются ≤ 4096 chars в подавляющем большинстве.
5. ✅ **analytic Langfuse при clone** — фикс уже в `clone-to-gold-poc.mjs`, memory `feedback_chatflow_clone_proxy_analytic`.

---

## Next steps

1. Реализация скрипта `experiments/specs-enrichment/upsert-real-merge-to-gold.mjs` по этому design.
2. Truncate existing gold-poc DS (через REST `vectorstore/{}?docId=*` или delete всех loaders).
3. Re-ingest 13 SKU = ~40 chunks (3 chunks × ~13 SKU + edge cases где 4 PDF на модель).
4. Re-run smoke `smoke-gold-poc.mjs` на том же 16Q test set.
5. Phase 0 v2 report с finalным gate decision.

Effort: 3-5 часов на implementation + smoke.

---

## Открытые вопросы (на доработку при необходимости)

1. **PDF picture data** — текущий docling pipeline теряет схемы установки / цветовые коды из паспортов. Если retrieval будет страдать на queries типа «как промыть модуль К5» (визуальная инструкция в паспорте) — нужен отдельный pipeline извлечения pictures через Vision LLM. **Известный gap**, не блокирует Phase 0 v2.
2. **Bundle attribution** — `Умягчитель WS500 + подарок DWM-101SN` сейчас относится к WS500 (main product), DWM-101SN promo упоминается в text но не отдельный chunk. Если AI начнёт fluffing «у DWM-101SN цена 94 980 ₽» (как promo bundle WS500) — пересмотреть.
3. **Множественные PDF на одну модель** — если для DWM-101S есть `DWM-101_instruction.pdf.json` + `dwm101-102S_v6_print.pdf.json` + `DWM-101SN_v2.pdf.json` — все merge'ятся в один specs chunk с разделителем `---`. Если редко противоречат — OK. Если противоречат — нужны policies (что приведёт к Альтернативе G ADR-010).
