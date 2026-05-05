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

## Next

- Топап Anthropic credits на $60-70.
- Запустить 4-shard parallel extract на 10 074 новых записей. ETA ~2-3 часа.
- После extract: tasks #31-#34 (LLM address parser → geocode v2) → карта.
