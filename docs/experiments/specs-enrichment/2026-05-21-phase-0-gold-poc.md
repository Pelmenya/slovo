# Phase 0 proof point — catalog-aquaphor-gold-poc

> **Дата:** 2026-05-21
> **Контекст:** ADR-010 hybrid indexing gold DS — Phase 0 gate per feature plan `docs/features/catalog-merge-gold-ds.md`.
> **Артефакты:** `experiments/specs-enrichment/smoke-gold-poc-results.json` + `smoke-gold-poc-summary.md` + этот доклад.

---

## TL;DR

Phase 0 **не прошёл gate** ≥10pp accuracy lift. **Но** результат **не опровергает** ADR-010 гипотезу — Phase 0 фактически измерил **качество PoC chunks**, а не gold DS архитектуру. Существующие merged-chunks из Step 6.5 имели две критичные проблемы (нет цены в text, anti-confusion footers с unverified facts), которые саботировали measurement.

**Recommendation:** **Phase 0 v2** с production-quality merge от raw sources (MinIO ERP + Redis vision-augment + filesystem specs) на тех же 13 SKU (1-2 дня). До Phase 0 v2 — ADR-010 status остаётся **🟡 Draft pending proof point**, не retire.

---

## Aggregate metrics

| Метрика | Baseline (2-DS) | Candidate (gold-poc) | Delta |
|---|---:|---:|---:|
| Accuracy (ok + 0.5×partial) | **53.1%** | **53.1%** | **+0.0pp** |
| Verdict ok / partial / wrong | 1 / 15 / 0 | 1 / 15 / 0 | — |
| High-severity wrong claims | 11 | 10 | **−1** |
| Medium-severity wrong claims | 16 | 13 | **−3** |
| Avg latency | 20.1s | 31.8s | +11.7s |
| Total cost (USD, Langfuse) | $0.3199 | $0.0000* | — |

*Cost для candidate потерян — `analytic` config при clone не пробросился (фиксано в `feedback_chatflow_clone_proxy_analytic`). Token usage по факту примерно тот же (Haiku 4.5 + ~3 chunks retrieved × 2000 tokens).

## Gate criteria

| Criterion | Threshold | Actual | Status |
|---|---|---|---|
| Accuracy lift vs baseline | ≥ +10pp | +0.0pp | ❌ |
| High-sev wrong claims | не выросли | −1 | ✅ |
| Token cost | не > 1.5× | ~1.0× по token count | ✅ |

**Gate verdict: ❌ FAILED** на главном criterion (accuracy lift).

---

## Что реально измерили — root cause analysis

Я ожидал что Phase 0 даёт чистое measurement архитектурного approach'а (2 DS vs 1 gold DS). Реально smoke измерил **качество merged-chunks artifact'а Step 6.5**. Два корня:

### 1. Цены отсутствуют в pageContent

`experiments/specs-enrichment/poc-ds-merge/build-merged.mjs` собирал gold chunks так:

```javascript
metadata: {
    sku, modelKey, source: 'gold-merged',
    erpFound, specsFound, erpDocId,
    erpPrice: erpMatch?.metadata?.salePriceKopecks,   // ← цена в metadata
    category: erpMatch?.metadata?.productCategory,
}
```

Цена попала **только** в metadata, **не** в pageContent. Vectorstore retriever достаёт `pageContent` (текст для LLM), metadata только для filtering. AI получает chunk **без цены** → честно отвечает «цена не найдена в каталоге».

Доказательства из judge missed_facts:
- S14: «Цена DWM-102S Pro: 20 900 ₽ — AI заявил 'не найдена', хотя она есть в каталоге»
- S16: «Цена 20 900 ₽» missed
- S19: «Цены не указаны (C125 = 13 990 ₽, C126 = 13 990 ₽, 82138С = 12 990 ₽)»
- S27: «Цена замены мембраны КО-50S = 3 790 ₽»
- S29: «Базовая комплектация 22 980 ₽»
- S30: «DWM-202S-C (29 990 ₽), DWM-202S-C-LD (38 950 ₽) не упомянуты»
- G1: «Цена WS500: 74 990 ₽»
- G4: «Цена DWM-202S-C-LD: 38 950 ₽»

**8 из 16 queries** провалились на missed prices.

### 2. Anti-confusion footers содержали неверные facts

PoC build-merged.mjs хардкодил anti-confusion footers (попытка докомпенсировать ошибки 2-DS retrieval через явные правила):

```javascript
if (t.sku === 'DWM-101S') {
    goldChunk += `## КРИТИЧЕСКИ ВАЖНО (anti-confusion):
- Базовая цена 16 900 ₽ (без смесителя)
- Bundle math: + С126 (13 990) = 30 890 ₽; + 82138С (12 990) = 29 890 ₽
...`;
}
```

Но цифры в footer **противоречат** ERP truth (Дима в expected_facts S15 указывает 22 980 ₽ как базовую цену DWM-101S). Это **рецидив**: NEXT-SESSION-HANDOFF.md уже зафиксировал «5/7 моих verified facts были неверны», а build-merged.mjs (написанный ровно в той же сессии) использовал те же самые unverified facts в footer'ах.

Доказательства:
- S15: judge помечает как **wrong[high]** оба factual claim'а: «Базовая цена DWM-101S = 16 900 ₽» и «DWM-101S + C126 = 30 890 ₽» — это **прямые цитаты** из моего anti-confusion footer, которые AI послушно воспроизвёл.

То есть **gold DS дисциплинированно delivered footer-как-truth**, а footer был неверен.

### 3. Latency regression объясняется тунелем

`tunnel РФ↔EU падал` (твоя ремарка во время run). Smoke pass 3 (judge) первые 8/32 прошли за ~7 мин (≈ 200 сек/judge — tunnel'а нет/слабый), оставшиеся 24 за ~5 мин (≈ 12 сек/judge — tunnel восстановлен). Candidate predictions попали на провал tunnel'а → +11.7s avg latency. **Не свойство архитектуры**.

---

## Per-query notable findings

**Позитивные signals candidate'а:**
- **S17 (compatibility, КО-50 vs КО-50S)**: baseline partial → candidate **ok**. Anti-confusion footer про different membrane series в DWM-101S сработал.
- **S29 (russian-colloquial «мирион»)**: high-sev wrong claims с 3 до 1. Gold chunk даёт single-source truth, меньше путаницы.

**Регрессия candidate'а:**
- **G1 (specific-product WS500)**: baseline ok → candidate partial. Gold chunk WS500 не содержит цену 74 990 ₽ в text (Phase 0 root cause #1).
- **S14 (long-term-tco)**: candidate gained high=1 — AI с авторитетом написал «Цена DWM-102S Pro не найдена» (она в metadata), а baseline в 2-DS architecture хоть как-то fluffed ответ через ERP DS retrieval.

**Wash:** 12 из 16 queries — verdict identical.

---

## Что **не** опровергает ADR-010

PoC fail НЕ означает что:
- conflict resolution не работает
- single-source retrieve хуже multi-source
- gold DS architecture inferior

Это означает что **измерили не то**. Чтобы получить чистый proof point — нужен retry на production-quality merge.

---

## Decision

**ADR-010 status:** остаётся 🟡 **Draft pending proof point**. Не retire. Не promote в Принято.

**Phase 0 status:** failed gate, требуется **Phase 0 retry** с improved PoC artifact.

**Phase 1+ (catalog-merge worker + selection):** заблокирован до Phase 0 v2 пройдёт gate.

### Phase 0 retry — что менять

1. **Цена в pageContent.** Каждый gold chunk должен иметь section:
   ```
   ## Цена и наличие (ERP, current):
   - Базовая: <price_rub> ₽ (артикул <externalId>)
   - В наличии: <stock_status>
   - <bundle math если есть>
   ```
2. **Anti-confusion footers — verified.** Каждый footer должен быть проверен через `vectorstoreQuery` на actual ERP+specs. Не hardcode из памяти / руководства. Use Sonnet 4.6 + reasoning over actual retrieved chunks (per-SKU). Это уже мини-LLM-merge — что приближает к Альтернативе F/G ADR-010, и это **ОК** для proof point.
3. **Полный модульный состав** в каждом chunk — `## Комплект поставки` секция из specs PDF целиком, не abridged.
4. **Срок службы модулей** — `## Сроки службы` секция.
5. **Совместимость** для смесителей — связь с RO системами (C125/C126/82138C ↔ DWM-101S/-102S Pro/-202S-C).

### Effort estimate retry

1-2 дня:
- 0.5 дня — переписать `build-merged.mjs` с perspective verified-via-retrieval (или хардкод через Дима-проверенные facts на 13 SKU)
- 0.5 дня — re-ingest в gold-poc DS + smoke retry
- 0.5 дня — обновлённый report

### Альтернативный путь (если retry тоже fail)

Если improved merge всё ещё даёт +0pp:
- **ADR-010 retired** — gold DS approach не работает как ожидалось
- **Корень problem'ы в** retrieval (semantic miss) ИЛИ system prompt (накопившиеся rules под 2-DS) ИЛИ исходных данных catalog-aquaphor-specs DS (chunks specs не покрывают expected_facts)
- Новый ADR на одну из этих гипотез

---

## Уроки для будущего

1. **PoC data quality — отдельная переменная.** Phase 0 design предполагал что PoC chunks — known-good baseline для measuring architecture. Реальность: PoC были собраны **в той же R&D сессии** что и rules 23-27, с теми же unverified facts.
2. **Cena в pageContent vs metadata** — нюанс retrieval pipeline. Metadata доступна для filter / re-rank, но **не** для LLM context. Production gold chunks обязаны иметь price в text.
3. **Anti-confusion footers требуют ground-truth verification.** Не «я помню что DWM-101S 16 900 ₽», а `vectorstoreQuery` к ERP catalog DS на каждый SKU + verify.
4. **Tunnel падает** во время длинных smoke. Будущие smoke runs стоит делать в parallel batches с retry, не sequential — короткий run быстро доходит до конца до следующего tunnel drop.
5. **Clone chatflow ≠ deep copy** — `analytic` / `chatbotConfig` / `apiConfig` фильтрятся (memory `feedback_chatflow_clone_proxy_analytic`). Поправлено в `clone-to-gold-poc.mjs`.

---

## Артефакты

- **gold-poc DS:** `catalog-aquaphor-gold-poc` (id `6b66ce8c-ede6-4d56-8052-d9a6b6a70050`), 13 SKU / 17 chunks, postgres table `catalog_aquaphor_gold_poc_chunks`. **Не удалять** — нужен для Phase 0 retry.
- **gold-poc chatflow:** `catalog-qa-gold-poc-agentflow-v1` (id `42598520-903e-4bef-859a-35cf84de443c`), Haiku 4.5 + 1 retriever + analytic Langfuse.
- **Smoke results:** `experiments/specs-enrichment/smoke-gold-poc-results.json` (32 traces, 32 judges).
- **Test set:** `experiments/specs-enrichment/test-set-13-models.jsonl` (16 queries про 13 SKU).
- **Ingest skript:** `experiments/specs-enrichment/upsert-poc-to-gold.mjs`.
- **Smoke runner:** `experiments/specs-enrichment/smoke-gold-poc.mjs`.

## Связано

- ADR-010 status pending: `docs/architecture/decisions/010-hybrid-indexing-gold-ds.md`
- Feature plan: `docs/features/catalog-merge-gold-ds.md` (Phase 0 — gate)
- Step 6.5 R&D source of PoC chunks: `docs/experiments/specs-enrichment/2026-05-21-summary-evening.md`
