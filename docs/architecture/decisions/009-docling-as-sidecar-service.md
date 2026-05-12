# ADR-009: Docling-service как Python sidecar рядом с monolith

## Статус
✅ Принято — 2026-05-12

## Контекст

В water-analysis ETL извлечение полей из 15 504 PDF-бланков было реализовано через **Claude Vision Haiku 4.5** (Flowise chatflow `water-analysis-extractor-vision-v1`). Стоимость: ~$220 sunk cost, плюс rate limit Anthropic Tier 2 (90 calls/min), плюс ~0.15% hallucinations в значениях (`iron_total: "0.2Z"` вместо `0.27`).

В мае 2026 появилась альтернатива — **IBM Docling 2.74**: open-source library для парсинга PDF (text-layer + TableFormer ML-модель для таблиц). Бенч на 15 504 PDF дал:
- Throughput: 2.062 PDF/s на GPU (6c × OMP=2 на RTX 4070 Ti Super), 93 минуты на full dataset
- Cost: $0
- Determinism: 100% (CPU↔GPU 98.9% identical, 1.1% cell-boundary jitter без semantic impact)
- Quality: 92.3% params agree с Vision, 5.2% параметров найдено больше (long-tail synonyms), 0.8% disagree (кандидаты в Vision-hallucinations)

Docling — **Python-only library**. Перенос на TypeScript нереалистичен (TableFormer = PyTorch ML-модель, ~500MB весов; нет официальной JS-обёртки). Это нарушает один из неявных гайдов ADR-001 (Modular Monolith): «один runtime, один language».

ADR-001 сам предусматривает триггер пересмотра: «нужен другой язык (Python для тяжёлого ML)». Этот триггер сработал — нужно решить: расширить monolith Python-зависимостью (через subprocess / FFI), или вынести в отдельный сервис.

## Решение

**Docling — отдельный sidecar Python-сервис рядом с slovo monolith.** Не часть `apps/api`/`apps/worker` (NestJS/TypeScript), не в одном Docker-образе. HTTP API через FastAPI, развёрнут как соседний контейнер в slovo compose-сети.

Структура:
- `apps/docling/` — Python 3.12 + Docling 2.74 + FastAPI 0.115.6
- Два варианта образа: `slovo/docling-service:0.1.0` (CPU, ~2GB, dev/fallback) и `slovo/docling-service:0.1.0-gpu` (GPU, ~6.4GB, torch cu121, prod-bench/ETL)
- HTTP контракт: `GET /health`, `POST /parse`, `POST /parse/tables` (multipart upload, JSON response)
- TS-сторона: `libs/water-blank-extraction/src/parsers/docling-table-parser.ts` парсит ответ `/parse/tables` в `TWaterBlankExtractionV1` — общий контракт с Vision-путём, downstream нормализация (`05-normalize.ts`) не различает источник.

NestJS-сторона будет дёргать `docling-service` по HTTP внутри docker-network через `DOCLING_BASE_URL` env (Slice 3, ещё не реализовано). Связь stateless, без shared БД.

## Альтернативы

### A. Python subprocess внутри NestJS (worker spawn'ает docling.py)

Плюсы:
- Один деплоймент
- Нет HTTP overhead

Минусы:
- **Загрузка моделей Docling каждый раз** — ~5-10 сек startup на каждый PDF (модели весом 500MB).
- Нельзя кешировать converter в memory между запросами.
- Зависимости (`torch`, `easyocr`, `transformers`) raise сложность Dockerfile на NestJS-стороне до 4+ GB.
- Loss изолированности — Python OOM кладёт NestJS worker.

### B. Docling-serve (официальная альтернатива)

[docling-serve](https://github.com/docling-project/docling-serve) — официальная FastAPI-обёртка от IBM. Использовать её вместо своей.

Плюсы:
- Меньше своего кода (~270 строк в `apps/docling/app/main.py`)
- Поддерживается upstream

Минусы:
- **Контроль над контрактом** — docling-serve может менять API между версиями (early stage, 0.x).
- Pinning сложнее — docling-serve тащит свои deps.
- Нет slovo-specific tweaks (50MB upload limit, non-root user, healthcheck, lifespan singleton converter).
- Документация скромная — для отладки нужно лезть в исходники, наша обёртка лучше документирована.

Отвергнуто. Возможен пересмотр после стабилизации docling-serve (1.0+).

### C. Vision-fallback only (ничего не менять)

Плюсы:
- Никаких новых runtime'ов
- Pipeline уже работает

Минусы:
- $220 cost накапливается на каждые 15K новых бланков
- Hallucinations 0.15% (350/240k значений) — без detection отравляют downstream
- Rate limit 90 calls/min блокирует mass-import (Tier 2)
- Vision-Haiku точнее на адресах/именах? Нет — Docling **точнее** на customerName (78.6% agree, Docling прав на disagreements), objectAddress (30% Vision клеит phone), 80% sampleDate disagreements (Vision дублирует testDate). Docling-secondary даёт second-opinion для cleanup.

### D. Docling-loader в Flowise

Использовать Docling как Document Loader внутри Flowise (как делают `Pdf`/`Docx`/`Unstructured` loaders).

Проверка: `docker exec slovo-flowise sh -c "ls flowise-components/nodes/documentloaders"` — 36 loaders, **Docling отсутствует**. Близкий аналог — **`Unstructured`** (Python-сервис от Unstructured.io, тоже с TableFormer-style table extraction).

Варианты:
- **Unstructured loader в Flowise** — нет нашего бенча, потребует прогон 15504 PDF через Unstructured.io API ($$$) или local install (тот же operational overhead что docling). Качество русских бланков unknown. Отложено.
- **Написать CustomDocumentLoader-обёртку** поверх `apps/docling/` HTTP API — Flowise сможет использовать docling как loader в RAG-сценариях (Phase 2 knowledge-base). Для текущего ETL не нужен — у нас нет Flowise в Docling-pipeline (нет LLM, нет prompt-engineering, нет retry). Запланировано как **отдельная задача** когда появится RAG-потребитель PDF/Word.

### E. pdftotext в monolith (без ML)

Плюсы:
- Lightweight (~10 MB poppler)
- Никаких ML-зависимостей

Минусы:
- Не парсит таблицы — даёт plain text без структуры
- TableFormer (ML-модель Docling) даёт coordinate-grid (row/col/text) — критично для бланков
- Уже пробовали в `2026-05-07-pdftotext-vs-vision-pilot.md` — слабо подходит для табличных бланков

## Последствия

### Плюсы

- **Cost $220 → $0** на каждые 15K бланков, $0 на маржинальный бланк
- **Determinism** — Docling воспроизводимо извлекает одно и то же из одинаковых PDF, в отличие от LLM
- **Throughput x1.4** vs Vision (2.06 PDF/s vs ~1.5 PDF/s на rate-limit ceiling), время на 15504 — 93 мин vs 2.9 ч
- **No rate limit** — локальный compute
- **Quality second-opinion** — Vision и Docling friction matrix выявляет hallucinations кросс-валидацией
- **Изоляция** — Docling crashes не кладут NestJS, можно перезапускать independently
- **Singleton converter** — модели в RAM один раз, latency на запрос ~1-3 сек GPU

### Минусы

- **Два runtime'а** — Python + Node.js. Версионирование зависимостей в двух requirements/package.json. Один разработчик-fullstack справится, но для команды это операционный долг
- **Wire-contract стабильность** — TS-парсер `docling-table-parser.ts` зеркалит JSON-схему Python-сервиса. Breaking change в `/parse/tables` (например, `cells.text` переименован) сломает TS без compile-time check'a. Защита: integration-fixtures под git (`__fixtures__/docling-*.json`) ловят drift в pre-commit
- **Не в `docker-compose.infra.yml`** — пока стоит отдельно через `apps/docling/docker-compose.yml`. Интеграция в slovo-network — Slice 3 (после `DOCLING_BASE_URL` env)
- **GPU + Ollama конфликт** — обе хотят GPU. При prod-ETL нужно `docker stop ollama-laguna` перед `docker compose -f docker-compose.bench-gpu-6c.yml up`. Конкуренция за общий ресурс — слабая операционная нагрузка
- **Деплой** — на Hetzner DE возможна установка (data не PII, физика воды), но потребует GPU-host или CPU-only mode (медленнее в ~7×)

### Граница с ADR-001 (Modular Monolith)

ADR-001 в секции «Когда пересмотреть» явно перечисляет триггеры: «нужен другой язык (Python для тяжёлого ML)». **Этот триггер сработал**, и `apps/docling/` — формальное исключение из monolith-принципа. Однако:

- Это **sidecar** (один внешний контейнер), не фрагментация монолита на N сервисов.
- Связь только HTTP-call в одну сторону (NestJS → docling), без shared БД / event bus.
- Доменно изолирован: единственная задача — PDF parsing. Никакой бизнес-логики slovo внутри.
- Может быть отключён без потери функциональности — Vision-fallback продолжит работать.

ADR-001 остаётся валидным для основной разработки. ADR-009 — точечное исключение «когда другого пути нет».

## Связанные ADR

- **ADR-001** (Modular Monolith) — этот ADR использует трigger пересмотра ADR-001 «нужен Python для ML». ADR-001 остаётся в силе для основного кода slovo.
- **ADR-004** (Claude primary LLM) — Vision-Haiku остаётся primary для extraction'а где Docling fail (сканы, плохой text-layer). Docling — primary для нативных PDF. Гибрид.
- **ADR-005** (Prisma + raw queries) — не затронут. `WaterAnalysisRaw` будет иметь `extraction_engine` column (Slice 3, отдельный амендмент к ADR-005 при необходимости).
- **`feedback_minimal_deps_proven`** в memory — обоснование: написали тонкую обёртку поверх Docling SDK, а не зависимость от docling-serve community-уровня.

## Когда пересмотреть

- **Если Docling выпустит официальный TS-port** (маловероятно — ML-модели через ONNX можно, но не сейчас) — переписать парсер в slovo lib, выпилить `apps/docling/`.
- **Если docling-serve достигнет 1.0 с зафиксированным API** — рассмотреть переход на upstream.
- **Если появится 2-й Python-сервис** в slovo — пересмотреть всю sidecar-стратегию, возможно вынести в отдельный repo (как mcp-flowise в ADR-008).
- **Если ETL переедет в managed cloud** (AWS Batch, GCP Cloud Run) — `apps/docling/` extracted в свой artifact registry, slovo monolith только consumer.

## Связанные документы

- `apps/docling/CLAUDE.md` — операционный контекст для разработки docling-сервиса.
- `apps/docling/README.md` — user-facing документация.
- `docs/experiments/water-analysis/2026-05-12-docling-migration.md` — главный план миграции с slices и progress log.
- `docs/experiments/water-analysis/2026-05-12-compare-full.md` — extraction-compare Docling vs Vision на 15 490 бланках.
- `libs/water-blank-extraction/src/parsers/docling-table-parser.ts` — TS-парсер ответа `/parse/tables`.
