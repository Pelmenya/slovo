# CLAUDE.md

Этот файл — операционный контекст для Claude Code при работе с этим репозиторием.

## Кто читает этот файл

Claude Code (Opus, xhigh effort) в терминале Дмитрия.

## Связанные проекты в воркспейсе

- `slovo/` (родительский monorepo) — основная AI-платформа на NestJS, потребитель этого сервиса.
- `slovo-llm/` (соседний проект разработчика) — локальный inference (Ollama), ортогональный, но на той же машине (i9-11900K, 64GB, RTX 4070 Ti SUPER 16GB).
- Prostor-app — мобильный фронт на Next.js, потребляет slovo API (heatmap, predict, equipment-suggest).

**Режимы работы:**
- **dev / fallback** — CPU-only (`docker-compose.yml`, `Dockerfile`, image `slovo/docling-service:0.1.0`, ~2GB).
- **prod-bench / ETL** — GPU (`docker-compose.bench-gpu-6c.yml`, `Dockerfile.gpu`, image `slovo/docling-service:0.1.0-gpu`, ~6.4GB). Требует stop Ollama (общий GPU). См. `2026-05-12-docling-migration.md` для команд.

Текущая активная инициатива (см. `slovo/docs/experiments/water-analysis/2026-05-12-docling-migration.md`): миграция extraction-стадии water-analysis с Vision-Haiku на Docling (этот сервис). Дмитрий валидирует, я кодю.

## Что это за проект

**docling-service** — тонкая FastAPI-обёртка вокруг IBM Docling для парсинга PDF (и DOCX/HTML/PPTX) в структурированный JSON. Делается как **отдельный микросервис** для проекта `slovo` (NestJS-монолит). NestJS будет дёргать этот сервис по HTTP, отправлять PDF, получать таблицы и markdown.

**Главный кейс:** парсинг бланков анализа воды (нативные PDF из Word, не сканы, с аккуратными таблицами параметров). Альтернатива текущему пайплайну `PDF → image → Haiku 4.5 vision → params`, который работает но дорогой и медленный.

**Гипотеза:** для нативных PDF с таблицами Docling даст результат за миллисекунды без LLM-вызовов. Финальную JSON-схему можно собирать либо детерминированным кодом, либо коротким вызовом Haiku по уже извлечённому markdown'у (дешевле картинки в 5-10 раз по токенам).

## Архитектурные решения

| Решение | Почему |
| --- | --- |
| Multi-stage Dockerfile | Builder со всем тулчейном и предзагрузкой моделей → runtime тонкий (~2.5GB вместо 4GB+) |
| CPU-only torch | У Dmitry серверы без GPU. CUDA-версия torch — это +3GB к образу впустую |
| Модели предзагружаются на этапе билда | Первый запрос не должен ждать загрузки 500MB с HuggingFace |
| Один converter на процесс (в lifespan) | Загрузка ML-моделей в RAM ~5-10 сек. Делаем один раз на старте |
| Один uvicorn worker | Docling сам жрёт CPU. Масштабирование — поднимать N контейнеров, не worker'ов |
| Non-root user в контейнере | Безопасность. Контейнер бежит под `app:app` |
| `do_ocr=False` по умолчанию | Бланки нативные. OCR только замедлит. Включается через изменение pipeline_options |
| Отдельный `/parse/tables` эндпоинт | Под основной кейс — таблицы. Не тащим лишний markdown всего документа |
| FastAPI, не Flask | Async, валидация через Pydantic, авто-Swagger, type hints |

## Структура

```
docling-service/
├── Dockerfile              # Multi-stage build
├── docker-compose.yml      # Локальный запуск
├── requirements.txt        # Pinned versions: docling 2.74, fastapi 0.115
├── .dockerignore
├── README.md               # User-facing документация
├── CLAUDE.md               # Этот файл
└── app/
    └── main.py             # Весь сервис в одном файле — пока что
```

Пока всё в одном `main.py` — проект маленький. Если разрастётся, делим:
- `app/converter.py` — инициализация и настройки Docling
- `app/schemas.py` — Pydantic-модели ответов
- `app/extract.py` — `_extract_tables` и хелперы
- `app/main.py` — только FastAPI routes

## Стек и версии

- **Python 3.12** (slim base image)
- **docling 2.74.0** / **docling-core 2.74.1** (актуально на май 2026)
- **torch 2.5.1 CPU** (из `download.pytorch.org/whl/cpu`)
- **FastAPI 0.115.6** + **uvicorn 0.32.1** + **python-multipart**
- **Pydantic 2.10.4**

Все версии — pinned. Не плыви по latest, повторяемость билда важнее.

## Команды

```bash
# Билд (первый раз ~10 мин — качается torch + ML-модели Docling)
docker compose build

# Запуск
docker compose up -d

# Логи
docker compose logs -f docling

# Health check
curl http://localhost:8000/health

# Парс PDF
curl -X POST http://localhost:8000/parse/tables \
  -F "file=@/path/to/blank.pdf" | jq

# Swagger UI
open http://localhost:8000/docs

# Остановка
docker compose down

# Полная пересборка с очисткой кешей (если что-то сломалось)
docker compose down
docker compose build --no-cache
docker compose up -d
```

## Эндпоинты

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET | `/health` | Liveness probe. Возвращает `{status, converter_ready}` |
| POST | `/parse` | Полный парс: markdown всего документа + все таблицы |
| POST | `/parse/tables` | **Основной для бланков воды.** Только таблицы, быстрее |
| GET | `/docs` | Swagger UI (FastAPI auto-generated) |

Файл всегда передаётся как `multipart/form-data`, поле `file`. Лимит 50 MB.

## Контракт ответа `/parse/tables`

```json
{
  "tables": [
    {
      "page": 1,
      "num_rows": 12,
      "num_cols": 5,
      "cells": [
        {"row": 0, "col": 0, "text": "Параметр"},
        {"row": 0, "col": 1, "text": "Метод"}
      ],
      "markdown": "| Параметр | Метод | ... |"
    }
  ],
  "elapsed_ms": 850
}
```

Каждая таблица отдаётся **в двух представлениях**: координатное (`cells`) для программного обхода и `markdown` для глаз и для скармливания Haiku если решит финальную нормализацию делать через LLM.

## Гайдлайны для редактирования

### Когда меняем что-то в `main.py`

1. Сохраняй pin версии Docling в `requirements.txt` синхронно с тем что в коде. Docling API между минорными версиями шевелится.
2. `_extract_tables` написана **защитно** через `getattr(..., default)` — это специально, потому что атрибуты Docling-моделей могут отсутствовать в edge case'ах. Не упрощай до прямых обращений.
3. Если добавляешь новый эндпоинт — добавляй и Pydantic response_model, и логирование `log.info` с `elapsed_ms`. Метрики потом снимать удобнее.
4. `converter` — глобальный singleton через `lifespan`. **Не пересоздавай его на каждый запрос.**

### Когда меняем `Dockerfile`

1. Любое изменение в стадии `builder` означает повторную загрузку 500MB моделей и пересборку torch — это ~10 минут. Делай аккуратно.
2. Слой `RUN python -c "from docling.utils.model_downloader..."` должен оставаться **после** `pip install` и **до** копирования из builder в runtime. Иначе модели не закешируются в слое.
3. Если добавляешь системные либы — добавляй и в `builder`, и в `runtime` секции отдельно. Они независимые.
4. `HF_HOME` и `DOCLING_ARTIFACTS_PATH` указывают на `/opt/models` — не меняй пути, на них завязан `chown` и копирование между стадиями.

### Когда добавляем зависимости

1. В `requirements.txt` — всегда **pin точную версию** (`==`), не `>=`.
2. Большие пакеты (`torch`, `transformers`, `easyocr`) выносим в отдельный `pip install` слой в Dockerfile для лучшего кеширования.
3. После добавления — `docker compose build` локально, проверить что собирается, прежде чем коммитить.

## Что НЕ делать

- **Не переписывай на async Docling-вызовы.** `converter.convert()` синхронный и CPU-bound. Оборачивание в `asyncio.to_thread` имеет смысл только если будем держать concurrent requests, и тогда нужно отдельно подумать про GIL и thread-pool. Пока не нужно.
- **Не включай OCR в pipeline_options "на всякий случай".** Это +500MB образа (easyocr/tesseract) и сильное замедление. Включаем только когда реально подсунули скан.
- **Не убирай `--workers 1` у uvicorn.** Несколько worker'ов = несколько копий моделей в RAM = OOM на 4GB лимите.
- **Не пиши свой парсинг таблиц поверх Docling**, если можно сделать через `doc.tables`. У них уже есть TableFormer ML-модель, она умнее любых эвристик.
- **Не коммить файлы из `/opt/models`** — это ML-веса, они качаются на билде.
- **Не используй `:latest` для образа** в docker-compose.yml. Версионируем образ (`slovo/docling-service:0.1.0`).

## Эмпирика и находки (2026-05-12 — bench-сессия)

### Варианты образа

| Tag | Базовый image | Размер | Назначение |
|---|---|---|---|
| `slovo/docling-service:0.1.0` | python:3.12-slim + torch CPU (cu) | 1.99 GB | Default. Dev без GPU, fallback, прод-кейсы без GPU. |
| `slovo/docling-service:0.1.0-gpu` | python:3.12-slim + torch cu121 | 6.37 GB | Прод-кейсы с GPU (full-validation passes, batch-ETL). |

**Архитектурный поинт:** torch CUDA wheels (cu121) ШИПЯТ С СОБСТВЕННЫМИ CUDA runtime libs (libcudart, libcublas, libcudnn). НЕ нужна `nvidia/cuda` base image — `python:3.12-slim` достаточен. От хоста нужна только `libcuda.so.1`, NVIDIA Container Toolkit hook'ает её автоматически при `docker run --gpus all`.

### CPU config sweep (i9-11900K, 8C/16T, на 40 PDF)

| Config | Throughput | srv p50 | Комментарий |
|---|---|---|---|
| 1×OMP=8 | 0.177 PDF/s | 5664ms | single in-flight, физ.ядра |
| 2×OMP=4 | 0.214 PDF/s | 9233ms | 2 параллельных, физ.ядра |
| **4×OMP=2** | 0.249 PDF/s | 15966ms | sweet spot CPU-only |
| **4×OMP=4** | 0.261 PDF/s | 15094ms | HT-loaded, ~5% быстрее, тяжелее термально (100% CPU) |

Sweet spot: **4×OMP=2** для комфортного использования (~50-80% CPU). 4×OMP=4 быстрее на 5% но рубит машину под 100%.

**Steady-state на 2000 PDF выше** чем sweep-цифры (warm-up overhead растворяется):
- 4×OMP=2: 0.286 PDF/s
- 5×OMP=2 (предельная экспирентация): 0.284 PDF/s — лишний контейнер уже не помогает на CPU.

### GPU scaling на RTX 4070 Ti Super (16 GB)

| Config | Throughput | srv p50 | VRAM | GPU util | Notes |
|---|---|---|---|---|---|
| 1c sequential | 0.758 PDF/s | 1309ms | 2.2 GB | 37% | baseline GPU, на CPU 12× медленнее |
| 4c × OMP=4 (2000 PDF) | 1.918 PDF/s | 2081ms | ~5 GB | 66% | sweet spot для CPU+GPU balance |
| **6c × OMP=2 (15504 PDF, измерено)** | **2.062 PDF/s** | **2912ms** | **~12 GB** | **~80%** | **production-config, 93 мин на full dataset** |

**Per-PDF latency растёт с параллельностью** (1.3s → 2.1s на 4c → 2.9s на 6c) — нормально для GPU compute contention. Scaling 6c/4c = 1.075× — почти потолок GPU compute на этом workload'е.

**Сравнение пайплайнов на 15504 PDF (измеренные цифры):**
- Vision-Haiku (апрель 2026, sunk): ~1.5 PDF/s, ~2.9 ч, **$220**, hallucinates
- CPU 5×OMP=2: 0.286 PDF/s, ~15.4 ч, $0, deterministic
- GPU 1c: 0.758 PDF/s, ~5.7 ч, $0, deterministic
- **GPU 6×OMP=2: 2.062 PDF/s, 93 мин, $0, deterministic** ← winner

**Vision API rate-limited, не compute-limited** — на Tier 2 (Anthropic) ceiling = 90 calls/min. GPU обходит Vision **в 1.4× по throughput**. Главный win Docling-миграции — **не скорость, а $$$ + детерминизм** ($220 → $0, hallucinations → none).

**Из 15504 PDF: 10 с zero tables** (~0.06%) — кандидаты на Vision-fallback или OCR-pass (сканы / битый text-layer).

### Bench-runner архитектура (`bench_bulk.mjs`)

Universal параметризованный runner. CLI:
```bash
node bench_bulk.mjs --label <name> --endpoints url1,url2,... --count N --heartbeat N
```

Принципы:
- **Idempotent** через JSONL append-only + per-PDF JSON files. `loadDone()` → `Set<order_number>`, skip уже сделанных. Restart-safe.
- **Stable hash-shuffle** через FNV-1a 32-bit. Свойство: `pickFiles(N) ⊂ pickFiles(M)` при N<M. Можно масштабировать N инкрементально без пере-обработки.
- **Pool=N воркеров** (1:1 с endpoints), shared queue, round-robin естественный (кто свободен — берёт следующий).
- **Heartbeat math** считает rate на NEW work этого run'a (`(state.done - state.startDone) / elapsed`), не total — корректно для resume'а с уже сделанными.
- **--label определяет paths:** `bench_${label}.jsonl` + `bench_responses_${label}/`. Разные конфиги пишут в разные labels, идёмпотентность per-label.

Compose-варианты:
- `docker-compose.yml` (CPU, 1 контейнер) — default dev setup
- `docker-compose.bench.yml` (2 контейнера CPU, OMP=8) — устаревший
- `docker-compose.sweep-{Nx,M}.yml` — артефакты sweep'a, по требованию
- `docker-compose.bench-gpu.yml` (1 контейнер GPU)
- `docker-compose.bench-gpu-6c.yml` (6 контейнеров GPU, OMP=2)

### Quirks извлечения имён параметров (нашлось на 1287 PDF)

1. **NFKC сплющивает unicode-надстрочники, но `⁻` (U+207B SUPERSCRIPT MINUS) → `−` (U+2212 MINUS SIGN), а не ASCII `-` (U+002D).** Любая normalize-функция для lookup'а в `PARAM_SYNONYMS` должна явно конвертить U+2212/2010/2011/2013/2014 в ASCII `-`. Иначе все формулы с минусом (NO₃⁻, F⁻, S²⁻, и т.д.) промахиваются.

2. **Dehyphenate regex для line-break artifacts** (`Электропровод- ность` → `Электропроводность`) должен быть **letter-letter**, не `(\S)-\s+(\S)`. Иначе `(S 2- )` теряет минус: `\S` совпадёт с `)` → match `2- )` → replacement `2)`. Правильно: `([a-zA-Zа-яёА-ЯЁ])-\s+([a-zA-Zа-яёА-ЯЁ])`.

3. **Cyrillic vs Latin в химформулах.** Docling text-layer возвращает `(Н 2 S)` (Cyrillic Н) и `(Са 2+)` (Cyrillic С) для бланков из PDF где font подмешан. Mapping таблица для известных chem-letters (`а→a`, `Н→H`, `С→C`, `Са→Ca`, `Р→P`, `В→B`, `М→M` и т.д.) применяется **только внутри `(...)` скобок** — за их пределами `Н` это легитимная Cyrillic в словах типа `Сероводород`.

4. **PARAM_SYNONYMS в slovo (`libs/water-blank-extraction/.../sanpin/sanpin-1-2-3685-21-v1.0.0.ts`) уже покрывает Vision-формы** (`'нитраты (no₃⁻)'`, `'фториды (f⁻)'`, и т.д.) — расширять под Vision НЕ требуется, баг был в моей comparator-normalize, не в synonyms.

5. **Multi-template датасет.** На 1287 PDF выявлены 2 шаблона лаборатории:
   - **22-23 × 8 столбцов** — Аквафор/Ефимов, ~92% выборки
   - **15 × 5 столбцов** — ~2% выборки, другая лаборатория, имена параметров: `Реакция среды pH`, `Цветность, град` (вместо `Водородный показатель` и `Цветность`). Для них либо отдельный parser-path, либо точечные synonyms.

6. **Coverage `PARAM_SYNONYMS` lookup** после pre-clean:
   - **63.8%** через `normLight` (NFKC + lowercase + minus-fix) — Vision-формы и простые Docling-формы
   - **+35.1%** через aggressive normalize (dehyphenate + strip "по " + collapse spaces в формулах + Cyrillic→Latin) → суммарно **98.9%**
   - Остаточный **1.1%** unknown — `Магний (Mg 2+` без закрывающей скобки (152 случая), 15×5-шаблон имена (~46), edge cases. Закрывается +1 правилом и 5-7 точечными synonyms.

### Persistence стратегия

JSONL append-only достаточно для prod-bench до 15504 PDF (~16 МБ JSONL + ~80 МБ JSON responses). Postgres staging table рассмотрели — overkill для exploration phase. **Если потребуется query-able**, миграция тривиальна:
```sql
CREATE SCHEMA bench;
CREATE TABLE bench.docling_raw (order_number VARCHAR PRIMARY KEY, raw_response JSONB, ...);
-- + node insert script читает JSONL, upsert
```

### Inspiration

[paperetl](https://github.com/neuml/paperetl) — научные ETL для PDF→SQLite/ES через GROBID. Архитектурно совпадает с нашим: extract → persist raw → normalize. Domain разный (academic papers vs lab forms), tools разные (GROBID vs Docling/TableFormer). У них multi-backend output (SQLite/JSON/YAML/ES) — у нас пока только JSONL, легко расширить.

## Контекст по slovo (родительский проект)

- **slovo** — AI-платформа Dmitry. NestJS модульный монолит, Prisma 7, pgvector, RabbitMQ, Flowise, Claude как основной LLM.
- 8 ADR уже написано (архитектурные решения по slovo). При интеграции docling-service в slovo — нужно будет написать ADR-009 для документации этого выбора (sidecar Python-сервис как исключение из ADR-001 modular monolith).
- Этот сервис деплоится **рядом** со slovo, не внутри. Связь через HTTP внутри docker-сети или k8s-кластера.
- NestJS-сторона: модуль `pdf-parser` или подобный, который инкапсулирует вызовы к docling-service. Обязательно с fallback на текущий Haiku-vision пайплайн если Docling вернул мало таблиц или пустой результат (детектор "это скан или нативный PDF").

## TODO / возможные улучшения

- [ ] Эндпоинт `/parse/detect` — возвращать только метаданные: есть ли текстовый слой, число таблиц, число страниц. NestJS использует для роутинга на Docling vs Haiku vision.
- [ ] Redis-кеш по SHA256 файла. Одинаковые бланки парсятся повторно бесплатно.
- [ ] Prometheus метрики через `prometheus-fastapi-instrumentator`.
- [ ] Тесты на сэмплах. Папка `tests/samples/` с парой реальных бланков (анонимизированных) + pytest проверяет инвариантные поля.
- [ ] GitHub Actions: lint (ruff) + build (docker buildx) + push в registry.
- [ ] Если бланки приходят страничками а не цельным PDF — добавить эндпоинт принимающий `application/zip` с группой PDF.

## Разделение ответственности при коде через Claude Code

Dmitry работает в режиме **manual confirmations на все bash-команды**, не auto/vibe mode. Поэтому:

1. Перед изменением кода — **сначала покажи план**, потом меняй.
2. Любой `docker build` или `docker compose` команду — **только после подтверждения**, билды долгие.
3. Если нужно проверить что-то в Docling API (атрибуты модели, версия) — лучше написать **короткий Python-скрипт-зонд** и попросить запустить, чем гадать.
4. Если правишь Python и не уверен в API — **проверяй через `python -c "..."`** в работающем контейнере: `docker compose exec docling python -c "import docling; print(docling.__version__)"`.
5. Помни про предупреждение из опыта работы с MARPLA: **верифицируй любые свои утверждения** о структуре файлов через `ls`/`grep`/`cat`. Не выдумывай несуществующие модули или эндпоинты.

## Поддерживаемые форматы Docling

PDF, DOCX, PPTX, XLSX, HTML, images (PNG/TIFF/JPEG), audio (WAV/MP3/WebVTT для ASR), LaTeX, plain text, Markdown. В сервисе сейчас валидация пускает только PDF — расширяй явно по мере необходимости.

## Ссылки

- Docling: https://github.com/docling-project/docling
- Docling docs: https://docling-project.github.io/docling/
- Docling-serve (официальная альтернатива нашему сервису, мы её НЕ используем потому что хотим контроль над контрактом): https://github.com/docling-project/docling-serve
- TableFormer paper: https://arxiv.org/abs/2203.01017
- Docling technical report: https://arxiv.org/abs/2408.09869
