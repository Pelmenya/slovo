# Phase 0 v2 result — gold DS не подтверждён вторым тестом

> **Дата:** 2026-05-21
> **Контекст:** ADR-010 Phase 0 v2 — real-source merge (MinIO ERP + Redis vision + MinIO specs) с pre-rendered specs markdown через Opus 4.7 в сессии.
> **Артефакты:** `experiments/specs-enrichment/smoke-gold-poc-v2-results.json` + `smoke-gold-poc-v2-summary.md`.

---

## TL;DR

**Phase 0 v2 hard failed** на двух-уровневом gate: accuracy **-3.1pp** vs baseline (53.1% candidate vs 56.3% baseline). High-sev wrong claims **+1**. По criteria из feature plan — `<0pp = hard fail = immediate retire ADR-010`.

**Главный root cause:** **multi-SKU queries падают** на single-DS retrieve. Gold DS с tematic chunking возвращает 3 chunks одной модели при K=3 — baseline 2-DS K=3×2=6 chunks от potentially 6 разных моделей. Это **точно** что предсказал architect-reviewer (Open Q #9 в ADR-010 amendment).

**Это второй fail подряд** (Phase 0 v1 — +0.0pp на PoC chunks; Phase 0 v2 — -3.1pp на real-source). Гипотеза ADR-010 — что conflict resolution = главный bottleneck — **опровергнута**. Реальный bottleneck = **retrieval recall на multi-SKU queries**.

---

## Aggregate metrics

| Метрика | Baseline (2-DS) | Candidate-v2 (gold-poc-v2) | Delta |
|---|---:|---:|---:|
| Accuracy (ok + 0.5×partial) | **56.3%** | **53.1%** | **-3.1pp** ❌ |
| Verdict ok / partial / wrong | 3 / 12 / 1 | 1 / 15 / 0 | — |
| High-severity wrong claims | 9 | 10 | **+1** ❌ |
| Medium-severity wrong claims | 15 | 12 | -3 ✅ |
| Avg latency | 17.8s | 18.0s | +0.2s (neutral) |
| Total cost (USD) | $0.3255 | $0.2665 | -18% ✅ |

## Two-level gate verdict

| Criterion | Threshold | Actual | Status |
|---|---|---|---|
| Accuracy lift vs baseline | ≥ +10pp pass / +5-9.9pp conditional / <+5pp retire | **-3.1pp** | ❌❌ Hard fail |
| High-sev wrong claims | не выросли | +1 | ❌ |
| Token cost ratio | не > 1.5× | 0.82× | ✅ |

**Outcome: ❌❌ Hard fail → ADR-010 retire.**

---

## Root cause analysis — почему gold DS хуже

### Regressions (ok → partial)

**S19 (list-mixers): «Какие смесители 2-в-1 у вас есть для подключения к фильтрам?»**
- Baseline (2-DS): **ok** — retrieved C125 / C126 / 82138C из ERP DS + specs accessory chunks → AI перечислил все три с ценами
- Candidate-v2 (gold): **partial** — retrieve вернул 3 chunks **одного** SKU (один смеситель целиком). AI знает только про эту модель в данный момент → не покрывает list-query.

**G2 (compatibility): «Какой умягчитель посоветуете для дома 4 человек — WS500, WS800 или WS1000?»**
- Baseline (2-DS): **ok** — все три WS-модели retrieve'нулись из обеих DS, AI сделал comparative analysis
- Candidate-v2 (gold): **partial (high-sev=3)** — retrieve вернул 3 chunks **одной модели** (одной WS), две другие не вошли в context → AI рекомендует «правильно по типу запроса» (WS800 для 4 человек) но без grounded comparison других опций → high-sev wrong claims на specs/compatibility

### Pattern

Gold approach optimизирован для **single-SKU queries** (точная цена / точные specs / точная совместимость). Но real-world queries **сильно скошены** к multi-SKU patterns:

- «Какие у вас есть X?» — list-query
- «Сравните X и Y» — compare-query
- «Что подойдёт для Z?» — recommendation-query (нужно знать **варианты**)
- «X лучше или Y?» — VS-query

**На таких запросах 2-DS retrieve выигрывает** просто потому что K=3×2 = 6 chunks может покрыть несколько SKU. Single gold DS K=3 видит только **одну** модель + tematic chunking ещё сильнее **зажимает** retrieve в один SKU (3 chunks этой одной модели).

### Не помогли

Все improvements Phase 0 v2 vs v1 **работали технически**:
- ✅ Цены в pageContent (не в metadata) — теперь visible AI
- ✅ Pre-rendered specs markdown через Opus 4.7 — human-readable, без `[object Object]` / camelCase JSON
- ✅ Vision augmentation per ERP item включена в catalog chunk
- ✅ Multi-PDF merge для одной модели (DWM-101S → 3 PDF в один markdown)
- ✅ Без unverified anti-confusion footers (root cause Phase 0 v1)
- ✅ Token cost снизился на 18%

Но **архитектурный gap** (single-DS retrieve scope) перевесил все content improvements.

---

## Что точно опровергнуто

1. **Гипотеза conflict resolution = bottleneck → нет.** Если бы это было правдой, gold с verified content должен был дать accuracy lift. -3.1pp говорит обратное.
2. **«Build-time merge → single-source-of-truth → лучше retrieve» → нет на multi-SKU queries.** Single-source убивает multi-SKU recall.
3. **Tematic chunking (catalog/specs/service per SKU) → ухудшает multi-SKU.** Каждый retrieve scope сужается до 1 SKU при K=3.

---

## Что **не** опровергнуто (но не доказано)

1. **gold DS с K=6+** может быть competitive — не замерили. Quick test: bump K=6-9 на candidate-v2 chatflow + re-smoke 4 multi-SKU queries (S19, G2, S13, S30). Стоимость: ~20 мин + ~$0.02. **Recommended next step** перед окончательным retire.
2. **gold DS как 1 chunk per SKU** (не tematic) — может работать если retrieve K=3 хочет все 3 модели. Не тестировали из-за splitter chunk_size. Если уменьшить content per chunk до <4096 chars — variant A может выжить.
3. **Hybrid retrieval (Альтернатива C)** — postgres tsvector + pgvector RRF поверх gold DS. Не замерили. Может компенсировать multi-SKU gap.
4. **Re-ranker (Альтернатива B)** — Cohere Rerank поверх K=10 retrieve. Не замерили.

---

## Decision

**ADR-010 status: 🔴 Retired** (после двух proof-point fails).

**Не открываем Phase 1+** по этому ADR. Hybrid indexing build-time merge approach **архитектурно не подходит** к real-world query distribution на катологе Аквафор-Pro.

**Куда идти дальше — три путя:**

### Путь A — Quick K=6+ test (20 мин, $0.02)

Bump retrieve K на candidate-v2 до 6-9 → re-smoke только multi-SKU queries (S13, S19, S30, G2). Если accuracy на multi-SKU восстановится — gold DS с K=6+ может быть viable. **Cheap to try перед finalretire**.

### Путь B — Pivot на retrieval bottleneck (новый ADR)

Принять что **retrieval recall = главный bottleneck**, не conflict resolution. Открыть новый ADR на:
- FTS hybrid (postgres tsvector + pgvector RRF)
- Multi-query strategy (LLM генерирует 2-3 sub-queries для multi-SKU questions)
- Metadata filter routing (`category=mixer` для list queries)

Existing 2-DS архитектура остаётся, добавляется retrieval enhancement layer.

### Путь C — Pivot на prompt rework

Принять что **prompt rules 1-27 накопились под 2-DS retrieval**. Переписать prompt под фокус на retrieval-grounded responses + explicit «не уверен → escalate». Не trogaем DS архитектуру.

**Default recommendation для следующей сессии:** **Путь A** (cheap test) → если не помогает → **Путь B** (new ADR на retrieval).

---

## Артефакты

- gold-poc-v2 DS (`63ad6992-8042-4634-8a77-86d16f594720`) — **оставляем** для Path A test и retrospect. После решения по дальнейшему пути — delete если не нужен.
- catalog-qa-gold-poc-agentflow-v2 chatflow (`3d7ac1f7-7036-4e43-acaa-bddf42193430`) — тот же.
- `experiments/specs-enrichment/rendered-specs-13-sku.json` — 13 markdown blocks (можно переиспользовать)
- `experiments/specs-enrichment/upsert-real-merge-to-gold.mjs` — pipeline merge
- `experiments/specs-enrichment/smoke-gold-poc-v2.mjs` — smoke runner
- `experiments/specs-enrichment/smoke-gold-poc-v2-results.json` — 32 traces + 32 judges
- MinIO `slovo-datasets/specs/aquaphor/` — 226 spec JSON остаются (используются если кто-то ещё захочет merge experiments)

## Уроки от Phase 0 v1 + v2

1. **PoC на subset 13 SKU тестировал не то что хотели.** Architect-reviewer предсказал multi-SKU recall issue в Open Q #9 ADR-010 — но я не учёл это в test set design. 13 SKU был выбран потому что у нас была merged-chunks.json от Step 6.5 на эти 13 — а реальные user queries сильно скошены к multi-SKU patterns которые этот subset недостаточно покрывает.
2. **Per-section embedding decoupling может вредить.** Я ожидал что separate embeddings (catalog / specs / service) → adaptive retrieve. На самом деле — narrower retrieve scope. Embedding не «знает» что у этой модели есть другие chunks с другими тэгами. Smart retrieve patterns требуют explicit chains (multi-query / metadata filter).
3. **2-DS «old» architecture работала лучше чем мы думали.** Step 6.5 measure'нул 52% real-world. Этот тест на subset показывает 56.3% — baseline остаётся в той же range. Не «плохой baseline», а «честный baseline».
4. **Specs PDF из docling имеют 115 уникальных section types** — манual rendering непрактичен, нужен либо LLM-агент (как я сделал в сессии для 13 SKU), либо jq-based pipeline (если можно сжать к ~10 канонических shapes). Future production-grade rendering — отдельный sprint.
5. **Token cost saving 18% на gold — единственный positive signal.** Но без accuracy lift это не оправдывает infrastructure cost.

## Связано

- ADR-010 → теперь Retired
- Phase 0 v1 result: `2026-05-21-phase-0-gold-poc.md`
- Phase 0 v2 design: `2026-05-21-phase-0-v2-merge-design.md`
- Feature plan: `docs/features/catalog-merge-gold-ds.md` (Phase 1+ заблокирован — не открываем)
