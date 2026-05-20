# Step 6 — Multi-retriever PoC plan (A vs B vs baseline)

> **Дата:** 2026-05-20
> **Status:** план, реализация по пунктам
> **Tracker:** Step 6.4 (A toolAgent), 6.4b (B AgentFlowV2), 6.5 (smoke 20-Q), 6.6 (decision matrix)

---

## 1. Зачем

`catalog-qa-poc-v1` (PoC от 2026-05-19) показал **14/20** правильных ответов на reference Q&A.
Один retriever — **catalog-aquaphor (ERP)**. Знает цены и категории, **не знает tech specs**.

После Step 1-3 в Document Store `catalog-aquaphor-specs` лежит **534 chunks** из **224 PDF паспортов** (tech specs, chemistry, compatibility, troubleshooting).

**Гипотеза:** добавление второго retriever на specs DS поднимет accuracy 14/20 → ≥17/20 на технических вопросах.

Тренировочно проверяем **два канонических pattern'a** Flowise 3.x:
- **A. Chatflow V1 + toolAgent + retrieverTool × 2** — Function-Calling agent
- **B. AgentFlow V2 + Retriever × 2 + ConditionAgent + Loop** — visual workflow с self-correction

Цель — понять trade-off и выбрать pattern для prod.

---

## 2. Что сравниваем

| Метрика | Baseline (PoC v1) | A (toolAgent) | B (AgentFlow V2) |
|---|---|---|---|
| Accuracy 20-Q | 14/20 | **≥17/20 target** | **≥17/20 target** |
| Latency P50 | ~2s | ~2-3s | ~3-6s |
| Cost per query | ~$0.002 | ~$0.002-0.003 | ~$0.005-0.010 |
| LLM calls per query | 1 | 1-2 | 2-3 |
| Self-correction | нет | нет | да |
| Visual debug UI | средне | средне | отлично |
| Сложность setup | низкая | низкая | средняя |

**Decision criteria для prod:**
- Если **A** ≥17 и **B** ≥17 → выбираем **A** (cheaper, faster).
- Если **A** <17 а **B** ≥17 → выбираем **B** (workflow добавляет ценность).
- Если оба <17 → проблема в retrieval quality (chunks / embedding / metadata), не в pattern.

---

## 3. План по пунктам

### 6.4.A — Chatflow V1 + toolAgent

- [ ] **6.4.A.1** Получить `flowData` от `catalog-qa-poc-v1` (уже есть в session)
- [ ] **6.4.A.2** Построить новый `flowData` JSON:
  - Keep: `chatAnthropic_0` (Sonnet 4.6 temp 0.2), `bufferMemory_0`, `documentStoreVS_0` → ERP
  - Add: `documentStoreVS_1` → specs (`storeId=792a7855-...`)
  - Add: `retrieverTool_0` name=`catalog_erp`, description=«каталог товаров с ценами и наличием»
  - Add: `retrieverTool_1` name=`catalog_specs`, description=«технические паспорта с tech-характеристиками, что фильтрует, совместимость»
  - Replace: `conversationalRetrievalQAChain_0` → `toolAgent_0` с system message
  - Edges: 2× DocStoreVS → 2× retrieverTool → toolAgent.tools[]; ChatAnthropic → toolAgent.model; BufferMemory → toolAgent.memory
- [ ] **6.4.A.3** Create через `flowise_chatflow_create` name=`catalog-qa-enriched-v1-toolagent`, type=`CHATFLOW`
- [ ] **6.4.A.4** Visual check через Playwright (memory `feedback_visual_check_after_chatflow_create`)
- [ ] **6.4.A.5** Smoke 3 quick queries (DWM-101S цена / DWM-101S давление / подбор RO под 20k ₽) — sanity

### 6.4.B — AgentFlow V2

- [ ] **6.4.B.1** Изучить AgentFlow V2 node schema через `flowise_nodes_get` для:
  - `startAgentflow` — entry point
  - `conditionAgentAgentflow` — router (LLM-based)
  - `retrieverAgentflow` — retriever нода (native)
  - `llmAgentflow` — LLM responder
  - `loopAgentflow` — self-correction loop
  - `directReplyAgentflow` — финальный output
- [ ] **6.4.B.2** Построить flow:
  - Start → ConditionAgent («вопрос про цену/наличие или про tech specs или оба?») → 2 branches → Retriever ERP / Retriever specs / both → LLM responder → DirectReply
  - Optional Loop: если retrieval weak → rephrase query → retry retriever (max 3 iterations)
- [ ] **6.4.B.3** Create через `flowise_chatflow_create` name=`catalog-qa-enriched-v1-agentflow`, type=`AGENTFLOW`
- [ ] **6.4.B.4** Visual check через Playwright
- [ ] **6.4.B.5** Smoke 3 quick queries — sanity

### 6.5 — Smoke 20-Q comparison

- [ ] **6.5.1** Из `docs/experiments/knowledge-base-poc/2026-05-19-catalog-qa-baseline.md` взять 20 reference Q&A с expected answers
- [ ] **6.5.2** Скрипт `experiments/specs-enrichment/smoke-comparison.mjs`:
  - Run 20 queries × 3 chatflows (baseline PoC v1, A, B) через `flowise_prediction_run`
  - Capture: response text, latency, source documents
  - Грейдинг ответов **вручную** Димой (subjective) в CSV
- [ ] **6.5.3** Comparison table результатов → `docs/experiments/specs-enrichment/2026-05-2X-step-6-results.md`

### 6.6 — Decision + cleanup

- [ ] **6.6.1** Решение какой pattern идёт в prod (по матрице из секции 2)
- [ ] **6.6.2** Удалить losing chatflow + losing DS если не нужен через MCP
- [ ] **6.6.3** Прод-готовый pattern экспортируется через **Flowise UI → Export** → файл в `infrastructure/exports/2026-05-2X-catalog-qa-enriched.json` (git-versioned)
- [ ] **6.6.4** Закоммитить + commit message + push

### 6.7 — Prod migration (отдельная задача, отложена)

- [ ] **6.7.1** Refactor `upsert-via-loaders.mjs` → `infrastructure/bootstrap/03-data-ingest.ts` с placeholder resolution
- [ ] **6.7.2** Backup `chunks.jsonl` + `specs.tar.gz` в MinIO bucket `slovo-datasets/catalog-aquaphor-specs/`
- [ ] **6.7.3** Bootstrap chain: `01-credentials → import-flowise-export → 03-data-ingest` (idempotent)

---

## 4. Принципы которым следуем

- **Не мутируем** существующее: catalog-qa-poc-v1 остаётся как есть (baseline для сравнения), catalog-aquaphor DS не трогаем
- **Идемпотентность**: повторный run скрипта = no-op (RecordManager defends)
- **Verify facts**: после каждого create — visual check через Playwright (см. memory `feedback_visual_check_after_chatflow_create`)
- **Не выдумываем**: только реальные expected answers в Q&A grading (memory `feedback_no_invented_facts_external_docs`)
- **Prod portability через native Export**: вручную placeholder'ы НЕ пишем (см. discovery 2026-05-20 — Flowise UI имеет native Export)

---

## 5. Открытые вопросы (для будущего, не блокируют PoC)

- Как часто PDF specs обновляются Аквафор? Если редко (раз в год) — manual re-extract OK. Если чаще — нужен auto-refresh pipeline.
- Linking key `modelKeys` достаточен или нужен alias table между ERP externalId ↔ PDF filename? Решим после smoke 20-Q когда увидим где LLM путается.
- `min_pressure_by_mineralization` таблицы (RO) и `removal_efficiency_degradation_matrix` (Modern) — структурированные данные. Имеют смысл уйти в SQL columns как **typed lookup** вместо текста в DS? Decision после prod-traffic анализа.

---

## 6. Tracking

Текущее состояние: **Step 6.1-6.3 DONE**, начинаем 6.4.

Update этот файл по мере закрытия пунктов — отмечать `[x]` + дату.
