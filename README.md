# slovo

AI-платформа на NestJS для production-LLM фич: vision-поиск, RAG, агентская оркестрация. Бэкенд для **prostor-app** (карта анализов воды + AI-каталог Аквафор).

Разработка ведётся **через Claude Code как основной инструмент производства кода** — планирование, декомпозиция, параллельные агенты, интеграция. Это даёт другую кадансу: 108+ коммитов за 2.5 недели, 1456+ тестов, ESLint clean, Husky enforces.

---

## Стек

| Слой | Технология | Версия | Зачем именно эта |
|---|---|---|---|
| Runtime | Node.js LTS | 24.15.0 | Native fetch, native FormData, AbortController, performance fixes vs 20 |
| Framework | NestJS (monorepo) | 11.1.19 | DI + decorators + class-validator + Swagger из коробки. Hexagonal-friendly. Workspaces — `apps/api` / `apps/worker` / `apps/mcp-flowise` / `apps/docling` + 6 `libs/*` |
| TS | TypeScript | 6.0.3 | strict mode, никаких `any`. ESLint enforces `no-explicit-any` + `no-unsafe-*`, `consistent-type-definitions: type`, naming `T`-prefix |
| ORM | Prisma | 7.7.0 | `prismaSchemaFolder` (multi-file schema), `prisma-generator-nestjs-dto`, raw SQL для pgvector / PostGIS |
| DB | PostgreSQL | 18 | + pgvector 0.8.2 (HNSW indexes), PostGIS 3.6.3 (bbox + grid агрегаты на 15 504 точек), кастомный образ `slovo-postgres:pgvector-postgis-pg18` |
| Cache / Queue | Valkey 9 + RabbitMQ 4 | | Valkey = Redis fork (BSD-3, без license issues). RabbitMQ — слой между producer и worker (NestJS microservices) |
| Object storage | MinIO | digest-pinned | Docker Hub freeze с Oct 2025, держим digest-pinned образ. Bucket `slovo-datasets` для catalog snapshots + water-analysis PDF |
| LLM | Anthropic Claude SDK | 0.90.0 | Sonnet 4.6 primary (точность), Haiku 4.5 fast (batch), Vision (mime sniff: image/png vs jpeg) |
| Embeddings | OpenAI `text-embedding-3-large` | 3072-dim | Лучше чем `-small` 1536-dim на русском + спец.терминах. Cohere multilingual — backup |
| RAG runtime | Flowise | 3.1.2 | Self-hosted, не Cloud. LLM Chain + Document Store + Vector Upsert API + RecordManager + multi-retriever |
| LLM observability | Langfuse | 3.169.0 | LLM tracing + cost per-feature + alert при превышении бюджета |
| PDF extraction | Docling | local | 6× GPU контейнеров + 8× CPU. Local-only, $0/extraction. 15 504 водных бланка + 264 PDF паспортов |

---

## Архитектура

**Modular monolith** (ADR-001). Не микросервисы — apps делят БД и память внутри одного процесса, плюс worker как отдельный процесс для cron + queue. Когда нагрузка вынудит — отдельные deployments тривиально.

```text
slovo/
├── apps/
│   ├── api/                  # HTTP-фасад. Только тонкие controllers + DTO. Бизнес — в libs/
│   ├── worker/               # RabbitMQ consumer + @Cron jobs (catalog-refresh каждые 4ч)
│   ├── mcp-flowise/          # 66 MCP tools — typed mirror Flowise REST API (для Claude Code)
│   └── docling/              # FastAPI-обёртка над IBM Docling, 6 GPU + 8 CPU контейнеров
├── libs/
│   ├── common/               # IP-throttler (с IPv6 /64 anti-rotation), envSchema, sanitize-errors
│   ├── database/             # Prisma client + auto-generated DTO через prisma-generator-nestjs-dto
│   ├── flowise-client/       # Тонкий HTTP-клиент Flowise REST (~50 LOC + 30 LOC тесты)
│   ├── flowise-flowdata/     # Typed builder для chatflow flowData JSON (10 typed factories, ~200 нод через introspection)
│   ├── storage/              # MinIO/S3 client с `forFeature()` паттерном per-feature credentials
│   ├── water-blank-extraction/ # Zod-схема + normalizer (исправляет Vision Mg/Mn swap 70%) + docling-table-parser + SanPiN 1.2.3685-21 v1.0.0
│   └── llm/                  # Абстракция LLM-провайдеров (Anthropic/OpenAI/Ollama)
└── prisma/
    └── schema/               # Multi-file (один .prisma на домен): health / water-analysis / knowledge-base / ...
```

**Боковое деление по доменам, а не по техническим слоям.** Один `.prisma` файл = один домен. Один `module/<name>/` = один use case. Не «services/repositories/dtos» папками.

---

## Что реально применяем (и почему так)

### Flowise как LLM-runtime, не самописный RAG

ADR-006 / ADR-008. **Не пишем свой RAG-loop в коде** — это болезненный maintain. Flowise держит:
- Document Stores (catalog-aquaphor 714 chunks, water-analysis-aquaphor 15 504 chunks, скоро catalog-aquaphor-specs)
- Conversational Retrieval QA Chain (PoC `catalog-qa-poc-v1`)
- Vector Upsert API (с RecordManager skip-if-unchanged)
- Эмбеддинги через credential-secured OpenAI proxy
- Chatflow versioning через JSON export/import

NestJS — **тонкий слой**: pull `latest.json` из MinIO, validate через zod, push в Flowise через REST.

### MCP tools для Claude Code (`apps/mcp-flowise`, 66 инструментов)

Каждый ритуал «curl с bearer-token, parse JSON, retry на 429» вшит в typed MCP tool. Я (Claude Code) не пишу curl-команды в lab-journal'ах — я зову `mcp__flowise-slovo__flowise_docstore_query` / `flowise_chatflow_create` / 64 другие.

```ts
// Пример: search по 714 chunks каталога Аквафор за 600 мс
mcp__flowise-slovo__flowise_docstore_query({
    storeId: "aec6b741-...",
    query: "Аквафор DWM-101S обратный осмос",
    topK: 8
})
```

ADR-008 объясняет почему self-built, не community-wrapper. Полный список tools — `apps/mcp-flowise/README.md`.

### Custom MCP tools для специфичных пайплайнов

Не только Flowise. Когда заметили что для отладки UI часто открываем браузер вручную — поставили **Playwright MCP**. Когда обнаружили **WAF TLS-fingerprint block** на aquaphor.ru curl-запросах — то же Playwright использовался для bypass (нативный TLS Chrome неотличим от настоящего браузера в JA3 базе Cloudflare).

### RecordManager skip-if-unchanged — 95× cost reduction

Flowise Vector Upsert по умолчанию **переэмбедит всё** на каждый refresh. С RecordManager хеш content сравнивается per-item — unchanged item пропускается. На 155 товаров каталога это разница:

| Без RecordManager | С RecordManager |
|---|---|
| $0.05 × 6 refresh/день = $0.30/день | $0.05 × 1 (первый) + ~$0 (последующие) = $0.05/неделю |

### IP throttler с IPv6 /64 anti-rotation (`libs/common/src/http/ip-throttler`)

Стандартный `@nestjs/throttler` использует full IPv6 как ключ. Атакующий может ротировать через /64 prefix получая новый IP **на каждый запрос**. Решение — extract `/64` сетевой адрес как ключ:

```ts
function extractIpTracker(ip: string): string {
    if (isIpv6(ip)) return ipv6.toNetworkAddress(ip, 64);
    return ip;
}
```

### Vision augmentation на ingest, не на search

При ingest каждого товара каталога Haiku 4.5 vision получает изображение и генерирует description «компактный белый фильтр под мойку с двумя картриджами». Это попадает в `pageContent` chunk. На search клиент пишет «белый компактный фильтр» — semantic match через эти descriptions, а не raw image embedding (которое работает плохо на multi-modal без специальных моделей типа CLIP).

Vision augmentation идёт **один раз на ingest** (~$0.10 на 155 товаров) + кэшируется через SHA256 binary картинки. Search request не дёргает Vision никогда → latency search ~600 мс vs ~3 сек.

### Multi-file Prisma schema

Один `.prisma` на домен. `prisma.config.ts` указывает на `prisma/schema/` директорию. Relations между файлами работают автоматически — Prisma склеивает в одну логическую schema. Не плодим один monolith `schema.prisma` на 2000 строк.

```text
prisma/schema/
├── main.prisma           # generator + datasource (только настройки)
├── health.prisma         # HealthCheck
├── water-analysis.prisma # WaterAnalysisRaw + WaterAnalysis + enums
├── knowledge-base.prisma # KnowledgeSource + KnowledgeChunk
└── ...
```

### Forward-only миграции с workaround для Flowise drift

У Prisma **нет `down()`**. Откат = новая revert-миграция. Главная сложность — Flowise держит свои таблицы (`<storeId>_chunks`, `<storeId>_record_manager`) **в той же БД, но вне Prisma history**. `migrate dev` хочет `reset` (снос данных).

Workaround — `migrate diff --from-migrations --to-schema --script` + ручной apply через psql + `migrate resolve --applied`. Shadow DB `slovo_shadow` + `SHADOW_DATABASE_URL`. Прецедент: `20260504072555_add_water_analysis`.

### Interval-first predictions (не point estimates)

Все kNN-прогнозы (water-analysis predict / depth-predict) отдают **3 интервала + pointEstimate + 4-level pdkStatus**, не одно число:

```json
{
    "iron": {
        "pointEstimate": 0.42,
        "intervalP10P90": [0.18, 0.91],
        "intervalIQR": [0.31, 0.59],
        "intervalHardRange": [0.05, 1.50],
        "pdkStatus": "borderline",
        "confidence": 0.73
    }
}
```

PhD по интервальному анализу обязывает. Plus: AI-консультант видит не «у вас 0.42 железа» а «диапазон 0.18-0.91, скорее всего ближе к 0.42, ПДК 0.3 — borderline» — даёт более честный совет.

### Vision + Docling canonical merge для water-analysis

15 504 PDF бланка анализов воды прошли двумя пайплайнами: Vision-Haiku (видит checkbox state, OCR-ошибки) и Docling local (text-layer perfect, checkbox blind). Per-field provenance merge: best-of-two с разбиением «откуда что» и `_diff` для review. +562 gained depths (3.6%), +47 sampleDate-bugfix, +1599 addresses. Docling позже cost $0 (local), Vision sunk $220.

### catalog-pdf-enrichment (текущий sprint, 20 мая)

Менеджеры **не заполняют карточки** (Slice 6 organisational debt 6-12 мес). Решение — **автоматически из публичных PDF Аквафор**. 264 PDF паспорта (sitemap.xml + /filters/instructions + 95 product cards + pro.aquaphor.ru) скачаны через Playwright (bypass WAF) → 6 GPU docling за 160 сек → 226 structured JSON. **Tie-breaker**: ERP wins price/availability, PDF wins tech-specs.

---

## Тесты + качество

| Метрика | Значение |
|---|---|
| Unit + integration tests | **1456+** |
| Test suites | 77 |
| Coverage threshold | 80% lines (для `apps/` и `libs/`) |
| ESLint enforced | `no-explicit-any` + `no-unsafe-*` + `consistent-type-definitions: type` + `naming-convention` T-prefix |
| Pre-commit | Husky: `npm run lint && npm test` (запрещён `--no-verify` без явного разрешения) |
| Review после push | 7 кастомных + 8 wshobson generic AI-агентов в `.claude/agents/` (architect-reviewer, nestjs-code-reviewer, prisma-pgvector-reviewer, llm-integration-reviewer, security-auditor, testing-specialist, docs-reviewer) |

---

## Быстрый старт

```bash
# 1. env
cp .env.example .env  # FLOWISE_API_KEY (после первого запуска UI), OPENAI_API_KEY, ANTHROPIC_API_KEY, S3_SECRET_KEY, AHUNTER_API_KEY
npm install

# 2. инфра
npm run infra:up      # Postgres + pgvector + PostGIS / Valkey / RabbitMQ / MinIO / Flowise
npm run tools:up      # pgAdmin / Redis Commander
npm run langfuse:up   # LLM observability (опционально)
npm run docling:gpu:up # 6× GPU контейнеров для PDF extraction (опц.)

# 3. миграции
npm run prisma:migrate:dev
npm run prisma:generate

# 4. запуск
npm run start:dev          # API на 3101
npm run start:worker:dev   # Worker (cron + RMQ consumer)
```

Проверка:

- API health: <http://localhost:3101/health>
- Swagger: <http://localhost:3101/api/docs>
- Flowise UI: <http://localhost:3130>
- MinIO Console: <http://localhost:9011>
- pgAdmin: <http://localhost:5050>
- Langfuse: <http://localhost:3100>
- Docling: <http://localhost:8000/docs>

---

## Зоны фич

| Фича | Статус | Что внутри |
|---|---|---|
| [vision-catalog-search](docs/features/vision-catalog-search.md) | ✅ Phase 1+2 | `POST /catalog/search` text/image/combined. Vision augmentation на ingest, IP-throttle, SHA256 image-cache, budget cap. **591 тест.** |
| [knowledge-base](docs/features/knowledge-base.md) | ✅ Phase 1 (text-MVP) | `apps/api/src/modules/knowledge/` — sync text-ingestion. Phase 2 (video/PDF/YouTube) отложен. |
| [water-analysis](docs/features/water-analysis.md) + [prostor-water-pivot](docs/features/prostor-water-pivot.md) | ✅ Phase 1.A-1.B + 2 + 4 backend | 15 504 бланка → structured. **7 endpoints** для prostor-app: heatmap / predict / depth-map / depth-predict / points / equipment-suggest / aquifer-stats. PostGIS bbox + grid (sub-100 мс), interval-first predictions. **1179 тестов.** |
| [smart-search-integration](docs/features/smart-search-integration.md) | 🟢 Phase 1 backend | Расширил `POST /catalog/search` response: `vision: { category, description, confidence } | null` + `matchScore: 0..100`. |
| [Slice 2 + 7 batched](docs/features/smart-search-phase-1-5-backend.md) | ✅ 20 мая | `productCategory` enum в metadata + «Цена: 16 900 ₽» в pageContent карточки. AI отвечает на budget-questions с конкретными ценниками. |
| [catalog-pdf-enrichment](docs/features/catalog-pdf-enrichment.md) | 🟡 Phase 0 в работе | 264 публичных PDF Аквафор → docling → отдельный DS `catalog-aquaphor-specs`. Multi-retriever chatflow. **Замещает Slice 6 ERP-guide.** |
| [catalog-ai-consultant](docs/features/catalog-ai-consultant.md) | ⏳ stub-план | Sticky AI-чат на странице каталога prostor-app. PoC закрыт 7/7 reference Q&A. |

---

## Документация

**Разработчику:**
- [Архитектура](docs/architecture/overview.md) + [8 ADR](docs/architecture/decisions/)
- [Тех.долг](docs/architecture/tech-debt.md) — pre-launch blockers
- [Flowise vs NestJS — что делаем где](docs/guides/flowise-vs-nestjs.md)
- [Конвенции нейминга Flowise](docs/guides/flowise-naming.md)
- [`apps/mcp-flowise/README.md`](apps/mcp-flowise/README.md) — 66 MCP tools

**Lab journals (experiments):**
- [water-analysis docling migration](docs/experiments/water-analysis/) — Vision → Docling canonical
- [knowledge-base PoC catalog QA](docs/experiments/knowledge-base-poc/) — baseline 14/20 reference Q&A
- [specs enrichment](docs/experiments/specs-enrichment/) — 264 PDF Аквафор

**Управлению:**
- [Executive summary vision-catalog](docs/management/vision-catalog-executive-summary.md)
- [Executive summary water-analysis](docs/management/water-analysis-executive-summary.md)
- [ERP product card guidelines](docs/management/erp-product-card-guidelines.md) — гайд для менеджеров (становится **optional** после catalog-pdf-enrichment)

**AI-ассистентам:**
- [`CLAUDE.md`](CLAUDE.md) — контекст проекта, технические предпочтения, MCP-арсенал, sibling agents (prostor-frontend / slovo-llm-runtime / crm-back)

---

## Лицензия

UNLICENSED — пока личный проект.
