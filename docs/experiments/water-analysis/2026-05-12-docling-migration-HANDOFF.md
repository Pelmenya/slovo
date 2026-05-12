# Docling migration — HANDOFF (для новой Claude Code сессии)

**Дата handoff:** 2026-05-12
**Goal:** заменить Vision-Haiku extraction stage water-analysis ETL на бесплатный детерминированный Docling.

## TL;DR для новой сессии

1. **Где docling-service:** `apps/docling/` (CPU + GPU Dockerfile, compose-файлы, FastAPI). Сервис **deployed and validated**.
2. **Где raw данные:** `experiments/water-analysis-dataset/data/docling-raw/` (gitignored, ~280MB). Содержит **15504 Docling-output'ов** + Vision-payload dump + parsed structured fields.
3. **Где отчёты:** `docs/experiments/water-analysis/2026-05-12-*.md` (migration plan, compare, params, sanpin-matrix).
4. **Текущий Slice:** **Slice 1.5 ✅ ЗАКРЫТ** (после Slice 1). Tuning `deriveIntakeType` на 15504 Vision-labels: threshold 25→15, `parseDepthMeters` range fix, `deriveIntakeTypeWithSource()` для observability. **Best accuracy 73.34% / 73.60% (slovo/domain-truth)** на Strategy C (hint + threshold=15). 240 tests in lib. **NEXT: Slice 4.2** (canonical best-of-both merge Vision+Docling) → **Slice 4.3** (re-geocode ~4600 changed addresses) → **Slice 4.2.5** (re-embed merged params, ~$0.30) → **Slice 3** (Prisma migration `extraction_engine` + `03b-extract-docling.ts`).

## Что сделано (timeline сжато)

| Slice | Что | Status |
|---|---|---|
| 0.1 | CPU sweep: 4×OMP=2 sweet spot, 4×OMP=4 max throughput | ✅ |
| 0.5 | Bench на 2000 PDF (CPU): 0.286 PDF/s | ✅ |
| 0.7-0.9 | GPU Dockerfile + 1c/4c/6c sweep | ✅ |
| 0.11 | Full 15504 PDF на GPU 6c × OMP=2: **93 мин, 2.062 PDF/s, $0** | ✅ |
| 0.6 | Analyze unique names — 98.9% coverage с aggressive preClean | ✅ |
| 0.10 | CPU↔GPU determinism — 98.9% identical (1.1% cell-boundary jitter, semantics не страдают) | ✅ |
| 4.1 | Params consistency: 92.3% agree, 0.8% disagree (Vision hallucinations кандидаты) | ✅ |
| 1.1 | preCleanName + spec в slovo lib (29 tests) | ✅ |
| 1.2 | docling-table-parser.ts + spec в slovo lib (32 tests, 2 fixtures) | ✅ |
| 1.3 | deriveIntakeType + spec в slovo lib (22 tests) | ✅ |
| 1.4 | PARAM_SYNONYMS расширение (+6 entries) + normalizer tests | ✅ |
| 1.5 | Tune deriveIntakeType на 15504 Vision-labels → **73.34% acc (Strategy C, threshold=15м)** | ✅ |
| 4.2 | Build canonical "best-of-both" dataset | ⏳ NEXT |
| 4.3 | Re-geocode changed addresses (~4600 бланков, ~600₽ Ahunter) | ⏳ |
| 4.2.5 | Re-embed merged params (~$0.30 OpenAI, 3 мин) | ⏳ |
| 3 | Schema migration extraction_engine + intake_source + 03b-extract-docling.ts | ⏳ |

## Discoveries (важно для новой сессии)

### Архитектурные

- **Docling text-layer НЕ видит checkbox state.** `intakeType` (скважина/колодец/водопровод/родник) **не извлекается прямо** из text-layer — все 4 ярлыка одинаково присутствуют в cells, без отметки ☑/☐. **Решение:** `deriveIntakeType(depthMeters, samplingPoint, customerNotes)` — алгоритмический эвристик с тюнингом по Vision-labels (Slice 1.5). Для **существующих** 15504: бесплатно берём `vision_payload.intakeType` из БД.
- **Docling видит handwritten пометки в text-layer.** "Запах" в форме "2ж", "3н" — Docling сохраняет, Vision срезает до цифры. Plus для downstream.
- **NFKC превращает `⁻` (U+207B) в `−` (U+2212), не в ASCII `-`.** Любая normalize-функция должна unify минус variants.
- **CPU↔GPU non-determinism: 1.1% cell-boundary jitter** (закрывающая скобка `)` мигрирует между соседними cells). Semantics не меняется. Parser должен быть устойчив (auto-close orphan `(`).

### Vision quality (что мы обнаружили в существующих 15504)

| Issue | Volume | Note |
|---|---|---|
| customerName OCR errors (типичные паттерны: замена одной буквы в фамилии, «щ»↔«ш», «Т»↔«Г») | ~20% | Docling text-layer прав |
| sampleDate = testDate duplicate bug | 65/81 = 80% disagreements | Vision дублирует test date в sample date |
| objectAddress phone-склейка | ~30% | Vision regex не разделил |
| params hallucinations (`"0.2Z"` вместо `"0.27"`) | ~0.15% (350/240k) | Docling точнее на 30 кейсах |
| **Vision missed params** (Docling нашёл больше) | 5.2% (12451/240k) | особенно magnesium (9065) — но это **artifact** slovo Mg/Mn positional fixup |

**Важно:** slovo `normalizeWaterParams` уже знает про эти Vision bugs:
- `applyManganeseDisambiguation` — позиционный fixup Mg ↔ Mn (10779/15504 бланков, 70%)
- `reclassifySulfatesToSulfides` — value < 1 mg/l под именем sulfate → sulfide (1870/15504)
- `reclassifyToHardnessByUnit` — мг-экв/л под именем conductivity/oxidizability → hardness_total (116)

То есть **derived water_analysis уже чище чем raw vision_payload**. Sравнение надо делать на derived уровне.

### Slovo PARAM_SYNONYMS gaps

Для **анионов** обе формы есть (`'нитраты (no3-)'` AND `'нитраты (no₃⁻)'`). Для **катионов только unicode**:
```
магний (mg²⁺)   ← unicode-only, нужна ASCII pair
марганец (mn²⁺) ← unicode-only
кальций (ca²⁺)  ← unicode-only
```

Docling text-layer возвращает `Магний (Mg 2+ )` → после preClean `магний (mg2+)` ASCII → slovo MISS. **Slice 1.1:** добавить ASCII formы для катионов + тесты.

## Файлы / артефакты

### Код slovo
- `apps/docling/` — Docling service (Dockerfile, Dockerfile.gpu, compose, app/main.py)
- `libs/water-blank-extraction/src/` — slovo extraction lib (sanpin synonyms, normalizer, parsers)
- `experiments/water-analysis-dataset/scripts/9*-*.ts` — analytics (91-97 ported from .mjs)

### Данные (gitignored)
- `experiments/water-analysis-dataset/data/docling-raw/`:
  - `bench_gpu_full.jsonl` (2.8 MB) — raw metrics 15504 PDF
  - `bench_gpu_full_parsed.jsonl` (25 MB) — structured fields 15504
  - `bench_responses_gpu_full/` (186 MB, 15504 JSON-файлов) — полные Docling responses
  - `vision_full.jsonl` (47 MB) — raw + derived Vision из БД
  - `bench_2000.jsonl` (244 KB) + `bench_responses_2000/` (16 MB) — CPU baseline 1327 PDF (для determinism check)
  - `params_diffs.jsonl` (128 KB) — 2017 hallucination candidates

### Документация
- `docs/experiments/water-analysis/2026-05-12-docling-migration.md` — главный план (slices, progress log, discoveries)
- `docs/experiments/water-analysis/2026-05-12-compare-full.md` — extraction-level + end-to-end compare
- `docs/experiments/water-analysis/2026-05-12-params-consistency.md` — per-paramCode consistency
- `docs/experiments/water-analysis/2026-05-12-sanpin-matrix.md` — SanPiN matrix (broken v1, нужно перепрогнать после Slice 1)

## Бенч-инфра (если потребуется re-run)

**CPU prod config** (4×OMP=2, ~50-80% CPU):
```bash
cd apps/docling && docker compose -f docker-compose.bench-cpu-4x2.yml up -d
```

**GPU prod config** (6×OMP=2, ~80% GPU util, **OLLAMA ДОЛЖНА БЫТЬ STOPPED**):
```bash
docker stop ollama-laguna
cd apps/docling && docker compose -f docker-compose.bench-gpu-6c.yml up -d
# wait converters ready, warm-up
npx tsx experiments/water-analysis-dataset/scripts/91-docling-bench-bulk.ts \
  --label gpu_full \
  --endpoints http://127.0.0.1:8000,...:8005 \
  --count 15504
```

## Slice 1.5 итоги (закрыт 2026-05-12)

**Метрики на 15504 Vision-labeled бланков:**

| Strategy | Accuracy | well_R | well_dug_R | municipal_R | spring_R |
|---|---|---|---|---|---|
| A baseline (threshold=15) | 72.88% | 0.68 | 0.61 | 0.96 | 0.00 |
| **C: hint + threshold=15m** ⭐ | **73.34%** | 0.68 | 0.65 | **0.95** | 0.41 |
| D: + dealer-majority | 74.53% | 0.92 | 0.67 | **0.26 ⚠️** | 0.41 |
| C (domain-truth re-mapped) | 73.60% | 0.68 | 0.65 | 0.95 | 0.41 |

Strategy D кажется лучше по acc, но ломает municipal-recall — wrong-equipment risk недопустим.

**Key findings:**
- Threshold 25→**15м** — peak в sweep, +5pp.
- `parseDepthMeters` range support (50-60м → 55, ~50м → 50, >50м → 50) — закрывает 676/15504 (4.4%) lost depths.
- `filename.customerNameFromFilename` имеет coverage **99.3%** (текст в скобках filename) — основной hint source.
- `filename.sourceTypeHint` всего 1.6%.
- Slovo normalize vs domain-truth расходятся всего в 0.3% (46 ордеров) — slovo нормализация honest.

**Target ≥95% недостижим без:**
- Extraction `samplingPoint` из Docling row 3 handwritten (Slice 3 extension parser potential)
- ИЛИ Vision-fallback на ~10% no-depth+no-hint edge cases (~$0.5 на 1500 бланков)

**Финальные изменения в lib:**
- `derive-intake-type.ts:WELL_DEPTH_THRESHOLD_METERS = 15` + comment про tuning
- **`deriveIntakeTypeWithSource()`** — параллельный API, возвращает `{ type, source: TIntakeSource }` для аудита в downstream.
- `parseDepthMeters` — расширенный regex для range/modifier.

**Slice 3 design pattern для ETL:**
```ts
const filenameHint = [
    filenameMeta.sourceTypeHint,
    filenameMeta.customerNameFromFilename,
    doclingExtraction.samplingPoint,  // если будет в Slice 3 extension
].filter(Boolean).join(' ');

const { type: intakeType, source: intakeSource } = visionPayload?.intakeType
    ? { type: mapVisionString(visionPayload.intakeType), source: 'vision' as const }
    : deriveIntakeTypeWithSource(doclingExtraction.depthMeters, filenameHint, null);
// → WaterAnalysis: intake_type, intake_source, extraction_engine
```

## Next steps (приоритет)

1. **Slice 4.2 — Canonical "best-of-both" merge (ISOLATED):** для каждого бланка решить какое поле взять из Vision и какое из Docling (params: Docling-value если abs diff > threshold + Vision-gall pattern, иначе Vision; objectAddress/customerName: Docling; intakeType: Vision; sampleDate: Docling если Vision-duplicate-bug).
   - **ОГРАНИЧЕНИЕ:** существующие `water_analysis` / `water_analysis_raw` **НЕ ТРОГАЕМ**. Никаких UPDATE, никаких BREAKING изменений в схеме. Downstream API (heatmap, predict, equipment-suggest, similar) продолжает работать на текущей таблице.
   - **Куда писать:** новый **JSON-artifact** `experiments/water-analysis-dataset/data/canonical/canonical_full.jsonl` (immutable, gitignored). Опционально в Slice 3 + добавим Prisma model `WaterAnalysisCanonical` как **отдельную таблицу** (additive migration), но в Slice 4.2 — JSON достаточно для analysis.
   - Pattern: read-only на existing, write-only в isolated artifact.
2. **Slice 4.2.1 — Diff report existing vs canonical:** для каждого ордера сравнить existing `WaterAnalysis` со свежим canonical JSON-artifact'ом. Поля: params, paramFlags, intakeType, objectAddress, sampleDate. Метрики: сколько ордеров где values поменялись, как поменялся exceedsPdk, distribution diff. Output: `data/canonical/diff-report.md`. Read-only. **Это даёт honest эффект миграции до commit'а.**
3. **Slice 4.3 — Re-geocode changed addresses:** ~4600 бланков где Docling дал чистый адрес (без Vision-склейки phone) → прогон через 04-geocode + 05-ahunter-cleanse. ~600₽ Ahunter, 1-2 мин. **Результаты в новые колонки (canonical_lat/canonical_lon)** или в JSON-artifact, existing geo-поля не перетираем.
3. **Slice 4.2.5 — Re-embed merged params:** бланки где params изменились (~50-70% из 15504) → новый embedding text через `generateEmbeddingText` → re-upload в Flowise Document Store. ~$0.30 OpenAI, 3 мин.
4. **Slice 3 — Schema + ETL:** `water_analysis_raw.extraction_engine` + `WaterAnalysis.intake_source` columns (Prisma migration), `03b-extract-docling.ts` script с pattern выше, test pass на 50 новых бланках.

## Не забывать

- **CPU↔GPU non-determinism** — parser должен быть устойчив к cell-boundary jitter.
- **intakeType для existing 15504** — берём из `vision_payload.intakeType` (sunk cost $220). Только для NEW blanks нужен algorithm.
- **slovo нормализатор уже фиксит** Mg/Mn swap, sulfide/sulfate value-based, hardness unit-based. Apple-to-apple compare делать **на derived** уровне (water_analysis.params), не на raw.
- **Vision API rate limit Tier 2** — 90 calls/min. Поэтому Vision-fallback нужен **дешёвый** (только на ~10% edge cases где Docling fail).

## Что сделать **прежде чем** удалять `C:/Users/Diamond/Desktop/docling/`

- Verify `apps/docling/` запускается (`docker compose -f docker-compose.bench-cpu-4x2.yml up`)
- Verify `experiments/water-analysis-dataset/data/docling-raw/` содержит все артефакты (15504 + responses)
- Verify ported `9*-*.ts` запускаются (`npx tsx experiments/.../scripts/96-analyze-unique-names.ts`)

После — `C:/Users/Diamond/Desktop/docling/` можно удалить.
