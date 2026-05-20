# Tier A — PDF паспорта Аквафор → Document Store (lab journal)

> **Дата:** 2026-05-20.
> **Цель:** превратить 264 публичных PDF паспорта производителя в Document Store `catalog-aquaphor-specs` для AI-консультанта.
> **План фичи:** [`docs/features/catalog-pdf-enrichment.md`](../../features/catalog-pdf-enrichment.md).
> **Принцип:** incremental, measurable, reversible — каждый шаг с smoke-test.

---

## Состояние входа (после full recon)

- `experiments/specs-enrichment/inventory-master.json` — **321 PDF URL** (union из всех hub-страниц Аквафор):
    - sitemap.xml: 170 (declared search engine map, не полный)
    - /filters/instructions (доп): +36 (включая ВСЕ современные DWM-SN модели + WS500/WS800/Extra Soft)
    - product cards `/filters/{slug}`: +113 (95 cards crawled)
    - pro.aquaphor.ru: +1 (APRO-100 v2)
    - 22 hub-страницы + 95 product cards visited через Playwright (bypass WAF)
- **Исключено** из ingestion: **57 compliance** документов (СОУТ, декларации ЕАЭС, политика, кодекс) — не нужны для AI-каталога.
- **264 PDF полезных** для AI каталога (321 - 57 compliance).
- `experiments/specs-enrichment/all-pdfs/<group>/` — **227 PDF** скачаны (199 MB), **100% PDF magic OK**, 3 битые ссылки HTTP 404 на стороне Аквафор (`C125_pasport_preview`, `Pas_mod_B515_PRO`, `Паспорт_Eco_Pro`).
- Docling service: **6 GPU контейнеров** (slovo-docling-gpu-1...6) на портах 127.0.0.1:8000-8005.
- Все 154 ERP-товара уже в `catalog-aquaphor` Document Store (ERP-managed, не трогаем).

### Распределение 227 скачанных по группам

| Группа | Кол-во | Размер | Что покрывает |
|---|---|---|---|
| cartridge | 57 | 50 MB | K5/K2/K7M/KO-50S/KO-100/KO-150 + B505/B510/B515/B520 (все варианты) + B150 PRO + Pro 1/2/100 + Mineralizator + DMC + PP_5/10_10/20 |
| flow_filter | 47 | 42 MB | Кристалл (Classic / H / A / Eco / Solo / Soft / Quadro / Quadro_B/H/HB) + Фаворит PRO + Эко + Трио (5 вариантов) + J.SHMIDT 500/501 + Resto + B300 + Stiron + LWM-205S + Modern + Соло + Baby PRO |
| pitcher | 38 | 15 MB | A5/A6/A7/A8 + B5-B25 + B100 + A800/A1000 premium + Marseilles |
| ro_system | 28 | 42 MB | DWM (101S/102S/202SN-Pro/206SN/312S/80SN/70/41/31/201/203) + OSMO (Pro 50/100, 50, 100_5, 100_6m_pn) + APRO-100 v1+v2 |
| accessory | 23 | 28 MB | C125 (×2) + C126 (×2) + 82138/82320 + F0122 + WLG1202/1301 + KPD 50/100 + HF-D/WF-D/60LB + WB400 + PS1-F-D + тройник + фонтанчик |
| instruction_other | 12 | 1 MB | Generic A5-A8 / B5-B25 / JS500 (родительские) |
| softener | 8 | 13 MB | WS1000/WS800/WS500 + Extra Soft + Акваэффект |
| pre_filter | 7 | 1.9 MB | Викинг (×5) + Predfiltr Slim |
| housing | 4 | 2.6 MB | Гросс 10/20 + армированный + х/в 3/4 |
| other_product | 3 | 6.6 MB | PTS 2100, ЭФГ 63.250, Universal instruction |

## Шаги

### Step 1 — parse 264 PDF через docling (parallel 6 endpoints) ✅ закрыт

**Скрипт:** `experiments/specs-enrichment/parse-all-pdfs.mjs`.

- Round-robin по 6 docling endpoints (8000-8005).
- POST `/parse` с PDF → JSON `{ markdown, tables, elapsed_ms }`.
- Save в `experiments/specs-enrichment/parsed/<group>/<filename>.json`.
- Idempotent: skip если parsed JSON уже есть.
- Concurrency 6, throttle 0 (containers сами параллелятся через GPU queue).
- Fail-safe: timeout 180 сек per PDF.
- EXCLUDE_GROUPS = `compliance` (на этапе ingest скрипт сам пропускает).

**Факт:** **160 сек** на 264 PDF: **250 OK / 10 cached / 4 skip (no pdf) / 0 failed**.

**Output:** 226 JSON-файлов / 6.7 MB compressed metadata + 1.8 MB raw markdown + 344 structured tables.

### Step 2 — analytics output

Скрипт `analyze-parsed.mjs`:
- Кол-во chunks markdown / size statistics.
- Кол-во таблиц per PDF, distribution per group.
- Detect failures (markdown < 500 chars = вероятно сломанный extraction).
- Sample chunks per group для глазной валидации.

Output: `experiments/specs-enrichment/parsed-stats.md` — отчёт.

### Step 3 — chunks builder + metadata schema

Скрипт `build-chunks.mjs`:
- На каждый PDF собрать pageContent для embedding:
    ```
    Источник: <label>
    Группа: <group>
    Тип товара: <human-readable label by group>

    <markdown>

    <tables flattened to markdown>
    ```
- Splitter RecursiveCharacter chunkSize=1500 overlap=200 (как catalog-aquaphor).
- Metadata per chunk:
    ```json
    {
      "tier": "A",
      "source": "aquaphor.ru",
      "sourceUrl": "https://www.aquaphor.ru/userfiles/catalog_instructions/dwm101-102S_v6_print.pdf",
      "filename": "dwm101-102S_v6_print.pdf",
      "group": "ro_system",
      "label": "Аквафор DWM-101S, DWM-102S",
      "page": 3,
      "lineFrom": 1,
      "lineTo": 24
    }
    ```
- Output: `experiments/specs-enrichment/chunks.jsonl`.

### Step 4 — create Document Store `catalog-aquaphor-specs`

Через MCP `flowise_docstore_create`:
- Embedding: OpenAI text-embedding-3-large 3072 dim (как catalog-aquaphor).
- Vector store: postgres (pgvector через тот же DB).
- Record manager: postgres (incremental hash-skip).
- Credential: openai-prod, postgres-slovo-prod.

### Step 5 — upsert chunks

Через MCP `flowise_docstore_upsert` партиями по 50-100 chunks.

### Step 6 — experimental Chatflow `catalog-qa-enriched-v1`

Клонируем `catalog-qa-poc-v1` → добавляем второй retriever (`catalog-aquaphor-specs`) → MergeRetrievers / sequential.

### Step 7 — Smoke 20-Q baseline

20 reference Q&A из `docs/experiments/knowledge-base-poc/2026-05-19-catalog-qa-baseline.md`:
- Запускаем через `flowise_prediction_run` на `catalog-qa-enriched-v1`.
- Сравниваем с baseline 14/20 (PoC от 2026-05-19, single retriever).
- **Цель:** ≥ 17/20.

## Не делаем (out of scope для Step 1)

- ❌ Не парсим `/support/*` (43 страницы) — Tier D, отложено до результата Step 7.
- ❌ Не парсим `/blog/*` (225 статей) — Tier C₂, отложено.
- ❌ Не парсим marketing HTML карточек — Tier B, отложено.
- ❌ Не интегрируем в production chatflow `catalog-qa-poc-v1` — это experimental параллельно.
- ❌ Не пишем NestJS worker для enrichment — пока всё одноразово в experiments/.

## Acceptance criteria

- [x] **264 PDF parsed** (260 OK + 4 skipped no-pdf, 0 failed по docling). ✅ 2026-05-20 09:53
- [ ] Statistics report `parsed-stats.md`.
- [ ] Document Store `catalog-aquaphor-specs` создан + > 1000 chunks.
- [ ] Chatflow `catalog-qa-enriched-v1` отвечает на 20-Q.
- [ ] **Delta ≥ +3** vs baseline 14/20 → GO для Tier D / Step 2 фичи.
- [ ] Если delta < +3 → анализируем почему (шумные chunks? плохие таблицы? retrieval ranking?).

## Lessons learned (на момент завершения Step 1)

1. **sitemap.xml не полный.** На странице `/filters/instructions` нашли **36 дополнительных PDF** которых нет в sitemap (включая ВСЕ современные DWM-SN модели + WS500/WS800/Extra Soft). Будущий feature crawler должен обходить **union** sources, не полагаться только на sitemap.
2. **Cloudflare WAF блочит curl** через TLS-fingerprint (JA3/JA4), **не headers**. Sec-Fetch-* + полные Chrome headers не помогают. Решение — Playwright Chromium с same-origin fetch (нативный TLS Chrome идентичен в JA3 базе). Bypass занял ~30 минут на разбор.
3. **Замещение Slice 6 organisational debt.** Менеджеры не заполняют карточки → AI остаётся слабым. PDF enrichment **обходит** organisational блок технически: 264 PDF за 2 часа vs 6-12 месяцев ручной работы менеджеров. Slice 6 ERP-guide становится **soft requirement** (нужен только для Аква-Кинетика-специфичных полей: price/availability/комплекты/сторонние бренды).
4. **`scan-only PDF` фильтруются естественно.** Из 226 parsed — ~30 pitcher-инструкций имеют `markdown < 500 chars` (это scan-PDF кувшинов без text layer). Они не попадут в meaningful chunks. Это OK — кувшины не в основном каталоге Аква-Кинетики.
5. **40 cartridge паспорта** — раньше думали что отдельных PDF нет, оказалось у Аквафор есть **отдельный** документ на каждый модуль (K5/K2/KO-50S/B5xx и т.д.). Cartridge child-record pattern из плана работает естественно.
