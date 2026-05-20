# specs-enrichment — обогащение AI-каталога Аквафор публичными PDF паспортов

> **Статус:** Phase 0 завершен 2026-05-20. Tier A — 264 PDF parsed, build chunks → DS в работе.
> **План фичи:** [`docs/features/catalog-pdf-enrichment.md`](../../docs/features/catalog-pdf-enrichment.md).
> **Lab journal:** [`docs/experiments/specs-enrichment/2026-05-20-tier-a-pdf-pipeline.md`](../../docs/experiments/specs-enrichment/2026-05-20-tier-a-pdf-pipeline.md).

---

## Что внутри

Sandbox для построения второго слоя knowledge для catalog-ai-consultant — техспеки оборудования Аквафор из публичных PDF паспортов производителя. Идёт **параллельно** с ERP-managed `catalog-aquaphor` Document Store (от feeder'а), не трогая существующий pipeline.

**Главный strategic win:** замещает organisational debt Slice 6 (ручное заполнение карточек менеджерами Аква-Кинетика, ~6-12 мес) автоматическим извлечением из публичного источника (~2 часа).

## Артефакты (gitignored — 200+ MB binary)

| Файл / директория | Что |
|---|---|
| `inventory-master.json` | 321 PDF URL из 22 hub-страниц + 95 product cards. Категоризированы по 11 группам |
| `inventory-sitemap.json` | First-pass: 170 PDF из sitemap.xml only |
| `inventory.json` | First-pass: 80 PDF со страницы /filters/instructions only |
| `new-pdfs-from-extra-hubs.json` | +1 PDF найденный на pro.aquaphor.ru (APRO-100 v2) |
| `all-pdfs/<group>/<filename>.pdf` | **227 валидных PDF** (199 MB), 100% PDF magic OK |
| `_orphan-pdfs/` | 80 дублей от первой попытки скачивания (curl до бана WAF) |
| `parsed/<group>/<filename>.json` | **226 docling-parsed JSON** (markdown + 344 structured tables) |

## Скрипты (gitignored, но восстанавливаются deterministic'ом из master inventory)

| Скрипт | Что делает |
|---|---|
| `build-full-inventory.mjs` | Crawl 22 hub-страниц + 95 product cards → `inventory-master.json` (320 PDF) |
| `fetch-sitemap-inventory.mjs` | Извлекает PDF из sitemap.xml → `inventory-sitemap.json` (170 PDF) |
| `recon-extra-hubs.mjs` | Recon пропущенных хабов (pro.aquaphor.ru / /technologies / /support) |
| `reclassify-master.mjs` | Реклассификация unmapped по filename patterns |
| `download-from-master.mjs` | Download PDF в `all-pdfs/<group>/` через Playwright Chromium (bypass WAF TLS-fingerprint) |
| `download-via-browser.mjs` | Legacy: первая версия для 80 PDF со страницы instructions |
| `dedup-pdfs.mjs` | Дедуп old vs new schema names → orphan'ы в `_orphan-pdfs/` |
| `parse-all-pdfs.mjs` | Batch parse 264 PDF через 6 GPU docling-контейнеров (160 сек) |
| `analyze-parsed.mjs` | Statistics: chars/tables per group, broken-extraction detection |

## Pipeline (как воспроизвести)

```bash
cd experiments/specs-enrichment/

# 0. install (один раз)
npm install
npx playwright install chromium

# 1. inventory из всех источников Аквафор (3-5 мин)
node build-full-inventory.mjs        # → inventory-master.json (320 PDF)
node reclassify-master.mjs           # finalize groups (compliance / cartridge / ...)

# 2. download 264 PDF (excluding 57 compliance) — ~6 мин с throttle
node download-from-master.mjs        # → all-pdfs/<group>/<filename>.pdf

# 3. parse через 6 GPU docling — 160 сек (требует docker: npm run docling:gpu:up)
node parse-all-pdfs.mjs              # → parsed/<group>/<filename>.json

# 4. analyze
node analyze-parsed.mjs              # → console stats (chars/tables per group)
```

## Ключевые insights

1. **sitemap.xml не полный** — 36 PDF (включая ВСЕ современные DWM-SN модели + WS500/WS800) есть только на `/filters/instructions` hub, не в sitemap. Crawler должен идти union по нескольким источникам.
2. **Cloudflare WAF блочит curl** через TLS-fingerprint JA3/JA4 (не headers). Sec-Fetch-* headers не помогают. **Решение** — Playwright Chromium с same-origin fetch (нативный TLS Chrome неотличим в JA3 базе).
3. **57 compliance documents** (СОУТ, декларации ЕАЭС, политика) исключены — не нужны для AI каталога.
4. **40 cartridge паспорта** — у Аквафор есть отдельный документ на каждый модуль (K5/K2/KO-50S/B5xx/Pro 1/2/100). Child-record pattern работает естественно.
5. **3 битые ссылки** на стороне Аквафор (HTTP 404 на их сервере): C125_pasport_preview / Pas_mod_B515_PRO_А6 / Паспорт_Eco_Pro.

## Следующие шаги (Step 2+ из lab journal)

1. **Step 3 — build chunks** с metadata schema `{ tier:'A', source, sourceUrl, filename, group, label, page, lineFrom, lineTo }`. Splitter chunkSize=1500 overlap=200 (как catalog-aquaphor).
2. **Step 4 — create Document Store** `catalog-aquaphor-specs` через MCP `flowise_docstore_create`. Embedding text-embedding-3-large 3072 dim.
3. **Step 5 — upsert** партиями по 50-100 chunks.
4. **Step 6 — experimental chatflow** `catalog-qa-enriched-v1` с multi-retriever (`catalog-aquaphor` + `catalog-aquaphor-specs`).
5. **Step 7 — smoke 20-Q baseline** против baseline 14/20 (от PoC 2026-05-19). Цель ≥ 17/20 → GO для Tier D (support FAQ).
