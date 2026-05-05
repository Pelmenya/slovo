# Слияние с архивом коллеги (Битрикс24): тайминги + lessons

> Lab journal от 2026-05-05. Расширили dataset с 5430 → 15504 уникальных бланка
> через shared-доступ к personal disk коллеги на Битрикс24. См.
> `2026-05-04-stage-1a-extract-costs.md` — финал предыдущего этапа.

## Контекст

Старый dataset (`~/Desktop/water-analysis-digitizer/blanks/`) — 5489 файлов
docx/pdf за 2020-2025, разреженно за поздние годы (2024-2025: <16 records).
DB у нас 5430 records. Нашлась shared-папка на Битрикс24 у коллеги
с **полной историей 2020-2026** (~15500 файлов до orderNumber 22630).

Цель — забрать недостающие ~10000 бланков, объединить с тем что уже было,
получить полный dataset для аналитики и карты.

## Этапы

### 1. Скачивание архивов через Битрикс24 Drive

**Проблема:** server-side архивирование Битрикс24 имеет лимит ~2 GB / 30s.
Bulk-download всей папки проваливается с «не удалось создать архив». Доступ
read-only (shared), WebDAV не показывает чужой personal disk.

**Решение:** Playwright-скрипт `00-fetch-bitrix.ts` —
- `chromium.launchPersistentContext` с `data/.bitrix-session/` для cookies
- Loop по pages (50 файлов/page = ~1 ГБ архив = в лимит)
- Per page: select all → click `БХ.Disk['FolderListClass_folder_list'].downloadGroup()` → wait + rename
- Cutoff по дате последнего файла на странице (parsing `от DD.MM.YYYY` из имени)

**Bugs пройденные:**
1. `waitUntil: 'networkidle'` зависал на login странице → `domcontentloaded` + ручной retry-loop по grid selector.
2. `waitForSelector(default visible:true)` ждал hidden template-row → нужен `state: 'attached'` + фильтр `:not([data-id="template_0"])`.
3. Двойной `waitForEvent('download')` race condition — переписал на один `Promise.all([waitForEvent, click])`.

**Результат:** **310 архивов, 14 GB, ~25 минут** wall clock на полный скачать
(2026-04-30 → 2020-03-25).

### 2. Smart-unzip с dedup

`00b-smart-unzip.ts` — извлекает только новые orderNumber:

```
fs_set: orderNumbers из текущих имён в blanks/
db_set: orderNumbers из water_analysis_raw
skip_set: union(fs_set, db_set)

for each archive:
  for each entry:
    parse orderNumber из filename
    if orderNumber in skip_set: skip
    else: extract
```

Использовали `adm-zip` для синхронного чтения zip.

**Результат за 30 секунд:**
- 15 037 entries в архивах
- **10 074 извлечено** (новые orderNumber)
- 4 940 skipped (пересечение по orderNumber — старый dataset уже имел их в .docx, в архиве .pdf)
- 23 без orderNumber в имени (мусор)

### 3. Bug: путь к blanks/

Первый запуск `01-convert.ts` нашёл только 5484 файла. Оказалось smart-unzip
писал в `~/Desktop/water-analysis-digitizer/blanks/`, а `01-convert.ts` читает
`experiments/water-analysis-dataset/data/blanks/`. **Два разных каталога.**

Quick fix: `cp -n` слил оба в `data/blanks/` за ~1 минуту. На будущее — single
source of truth (либо передавать BLANKS_DIR через env, либо использовать одну
точку).

### 4. Sharding для convert + rasterize

Добавил `WATER_SHARD_INDEX` / `WATER_SHARD_TOTAL` в обоих скриптах (тот же
паттерн что в `03-extract.ts` вчера). Modulo-разбиение, 8 шардов.

**Convert (8 шардов parallel):**
- 5 430 старых → existing-output skip
- 10 074 новых → 9 924 PDF просто copy + ~150 docx → Gotenberg
- **84 секунды wall clock**, 0 errors. ~120 records/sec.

**Rasterize (8 шардов parallel, mupdf WASM CPU-bound):**
- 10 074 новых PDF → PNG, 200 DPI
- **194 секунды wall clock** (~3.5 мин), 0 errors. ~52 records/sec.

CPU usage стабильно 70-80% (8-ядерная машина). Sweet spot 8 шардов на CPU-bound
задачах — выше упирались в context switching.

## Текущее состояние

```
blanks/        15 523 файла  9.5 GB    (5489 docx + ~10000 pdf + 7 trash)
normalized/    15 504 PDF    9.5 GB    (готовы к rasterize/extract)
pages/         15 799 PNG    7.9 GB    (готовы к extract)
bitrix-archives/  310 zip   14   GB    (можно удалить после успешного extract)
DB             5 430 records           (старые, vision_payload extracted yesterday)
```

Disk: 41 GB total на experiment, остаток на C: ~78 GB.

## Готовность к extract

10 074 новых записей × $0.012/call (вчерашний actual rate) = **~$121**.

Credits на сейчас: ~$66 → дефицит $55 → нужен топап на $60-70 для full coverage.

## Тайминги по этапам (всё за один час)

| Этап | Wall time |
|---|---|
| Bitrix fetch (310 архивов) | ~25 мин |
| Smart-unzip (10 074 файла) | 30 sec |
| Merge blanks/ caталог | 1 мин |
| Convert (10 074, 8 шардов) | 84 sec |
| Rasterize (10 074, 8 шардов) | 194 sec |
| **Итого pre-extract** | **~33 мин** |

vs single-thread оценка `~10000 × 5sec/file = 14 hours` — **ускорение ~25×**.

## Lessons learned

1. **Persistent context Playwright записывает cookies только при graceful close** —
   при timeout exit cookies не сохраняются. Workaround: polling-loop с диагностикой
   вместо одного waitForSelector.
2. **Bitrix24 main-grid содержит hidden template-row** — нужен `:not([data-id="template_0"])` selector + `state: 'attached'`.
3. **Sharding везде** где возможно — convert / rasterize / extract. 8 шардов для
   CPU-bound, 4 для API-bound (Anthropic rate limit input tokens).
4. **Skip-set логика smart-unzip** — простое решение проблемы пересечения форматов
   (.docx vs .pdf для одного orderNumber). UNIQUE constraint в DB защищает повторно.
5. **Single source of truth для blanks/** — на будущее. Сегодня потеряли 5 минут
   на разные пути.

## Финал extract (Этап 1.A complete для расширенного датасета)

Запущен 6-shard parallel, потом перезапущен в 7-shard после restart системы (порвался прокси-туннель). MAX_RETRIES поднят с 4 до 10. 0 errors на оба прогона.

**Финал DB: 15 504 записей** (100% от готовых PNG, 0 missing). Шарды в modulo-buckets сами догнали 155 «ранее missing» orderNumber из старого dataset.

| | |
|---|---|
| Total records | 15 504 |
| Total parallel time (две сессии) | 6h 4m wall clock |
| Errors | 0 |
| Avg params/record | 15.7 |
| Coverage 14+ params | 99.6% |
| Coverage objectAddress | 97% |
| Coverage sampleDate / intakeType | 100% |

## Экономика (полная по обоим дням 2026-05-04 + 2026-05-05)

### API-side (Anthropic billing)

| Дата | Input M | Output M | Cost $ |
|---|---|---|---|
| 2026-05-04 | 38.09 | 4.82 | $62.21 |
| 2026-05-05 | 69.14 | 8.92 | $113.74 |
| 2026-05-01..02 (Sonnet/Flowise misc) | small | small | $0.30 |
| **API base** | **107.6 M** | **13.7 M** | **$176.25** |

### Out-of-pocket (Россия)

| Item | $ | ₽ (≈100 ₽/$) |
|---|---|---|
| Anthropic API base | $176.25 | 17 625 ₽ |
| + VAT 21% (digital services) | +$37.01 | +3 700 ₽ |
| + ~2% currency conversion (EUR→USD карта) | +$4.27 | +427 ₽ |
| **Total Этап 1.A real-spend** | **~$217.53** | **~21 750 ₽** |

### Cost per record

- $217.53 / 15 504 = **$0.0140 / record** = **1.40 ₽/бланк**

### Upcoming spend (Этап 1.B — address parser + geocode-v2)

| Шаг | Бюджет |
|---|---|
| LLM address parser (#33, ~10 074 × $0.0008 Haiku 4.5) | ~$8-12 |
| Ahunter geocode v2 fetch (~70% match × 10 074 × 20коп) | ~1 500 ₽ |
| + VAT/conversion на LLM | ~$2.50 |
| **Итого Этап 1.B clean+geo** | **~$15 + 1 500 ₽** ≈ **3 000 ₽** |

### Совокупно к концу Этапа 1.B (full prod-ready dataset с координатами)

| | $ | ₽ |
|---|---|---|
| Этап 1.A (extract) | $217.53 | 21 750 ₽ |
| Этап 1.B (clean + geocode) | $15 | ~3 000 ₽ |
| **TOTAL** | **~$232** | **~24 750 ₽** |

**Cost per record final ≈ 1.6 ₽/бланк** с координатами и нормализованными адресами.

## Lessons learned

1. **Persistent context Playwright записывает cookies только при graceful close** —
   при timeout exit cookies не сохраняются. Workaround: polling-loop с диагностикой
   вместо одного waitForSelector.
2. **Bitrix24 main-grid содержит hidden template-row** — нужен `:not([data-id="template_0"])` selector + `state: 'attached'`.
3. **Sharding везде** где возможно — convert / rasterize / extract. 8 шардов для
   CPU-bound, 7 для API-bound (Anthropic rate limit input tokens).
4. **Skip-set логика smart-unzip** — простое решение проблемы пересечения форматов
   (.docx vs .pdf для одного orderNumber). UNIQUE constraint в DB защищает повторно.
5. **Single source of truth для blanks/** — на будущее. Сегодня потеряли 5 минут
   на разные пути.
6. **Прокси-туннель к Anthropic нестабилен в peak hours** — MAX_RETRIES=10 с
   exp backoff (max 30s) спасает от потери записей. Шарды живут даже при 30+
   секундных таймаутах через retry-loop.
7. **Modulo-sharding идемпотентен по orderNumber** — даже после restart системы
   и перезапуска шардов с другим SHARD_TOTAL (6→7), они догоняют пропущенное
   через DB skip + iter all bucket.
8. **Out-of-pocket cost для РФ ≈ +25%** к Anthropic billing (VAT 21% + conversion
   2% + bank-fees). Учитывать при планировании бюджетов на API.

## Next (Этап 1.B)

- Tasks #31 → #36 (миграция fields → Flowise chatflow → batch wrapper → geocode v2 → manual override).
- Бюджет ~$15 + 1 500 ₽ Ahunter = **~3 000 ₽** total доплат.
- ETA реализация: 4-6 часов работы + ~30 мин batch processing.
- На выходе: **~80% записей с lat/lon coords** на карте, **~5-10% city-fallback**.
