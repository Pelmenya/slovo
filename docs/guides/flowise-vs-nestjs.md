# Flowise 3.1.2 в slovo — что умеет, чего нет, как компенсировать

> **Дата:** 2026-04-22 (вечер)
> **Основано на:** research официальной доки Flowise 3.x + обсуждение с разработчиком.
> **Замечание:** старая версия этого документа была по тьюториалу Flowise 2.x (`test-marpla/docs/tutorial/`). В 3.x многое изменилось — используйте только этот документ как актуальный reference.
> **Связанные:** `docs/architecture/decisions/006-knowledge-base-as-first-feature.md`, `docs/features/knowledge-base.md`.

---

## TL;DR

**Flowise 3.1.2 — production LLM-orchestration слой для slovo.** Покрывает ~70% AI-pipeline: LLM (Claude, OpenAI, Ollama), embeddings + pgvector, chunking, retrieval, Memory 10 типов, MCP client с готовыми серверами, Langfuse native.

**НЕ покрывает 3 критичных для slovo вещи:** транскрибация видео/аудио, prompt caching Claude, async long-running jobs. Всё это **инжектим из NestJS** через стандартные интеграционные точки Flowise.

---

## ✅ Что Flowise 3.1.2 умеет «из коробки»

### Ingestion (text, PDF, URL, и т.п.)

| Источник | Как |
|---|---|
| **Plain text** | Text Loader node + Vector Upsert API |
| **PDF** | PDF Loader node (автоматически парсит) |
| **CSV / Excel** | CSV/Excel Loader node |
| **URL (web article)** | Cheerio/Playwright Web Scraper loader |
| **GitHub repo** | GitHub Loader node |
| **Notion, Confluence, Jira** | Отдельные ноды есть |
| **Vector Upsert API** | `POST /api/v1/vector/upsert/{chatflowId}` — multipart файл → Flowise сам chunk + embed + save в pgvector за один вызов |

### Chunking (Text Splitters)

- Recursive Character (по умолчанию, разбивает `\n\n` → `\n` → `. ` → ` `)
- Character Text Splitter
- Token Text Splitter
- Markdown Text Splitter
- Code Text Splitter
- HTML Text Splitter

**Gotcha:** chunk size по умолчанию в **символах**, не токенах (1 токен ≈ 4 символа).

### Embeddings

- OpenAI (`text-embedding-3-small` / `-3-large` / `ada-002`)
- Cohere (`embed-multilingual-v3.0` — хорошо с русским)
- HuggingFace (self-hosted / Inference API)
- Ollama (локальные модели)
- Google / VoyageAI / Mistral / Jina

### Vector Stores

- **Postgres/pgvector** — нода работает с **существующей** схемой (НЕ создаёт таблицы сама)
- Pinecone, Qdrant, Chroma, Faiss, Weaviate, Milvus, Redis Vector
- In-memory (для прототипов)

### LLM providers

- **Anthropic Claude** — `ChatAnthropic` нода (first-class)
- OpenAI (`gpt-4o`, `o1`, и т.д.)
- Google Gemini / VertexAI
- Groq (те же модели + Whisper только через API, но **без Whisper-ноды**)
- Ollama (локальные)
- Mistral, Cohere, TogetherAI, Perplexity, и ещё 10+

### Memory (10 типов)

| Тип | Хранение | Persistence |
|---|---|---|
| Buffer Memory | RAM | ❌ теряется при рестарте |
| Window Memory (`k` последних) | RAM | ❌ |
| Summary Memory (LLM суммирует) | RAM | ❌ |
| Entity Memory | RAM | ❌ |
| **Redis-Backed Chat Memory** | Redis | ✅ TTL |
| **PostgreSQL Chat Memory** | Postgres | ✅ постоянно |
| MongoDB Atlas Memory | MongoDB | ✅ |
| Zep Memory | Zep (внешний) | ✅ |
| OpenAI Assistant Memory | OpenAI Threads API | ✅ |
| Conversation Summary Memory | RAM + optional external | ⚠️ |

Изоляция по `sessionId` (передаётся через `overrideConfig.sessionId`).

### Retrieval

- top-K similarity search через любой vector store
- **Conversational Retrieval QA Chain** — готовая нода: query reformulation через LLM → retrieval → ответ с memory
- MultiQuery Retriever (упоминается)
- Contextual Compression Retriever
- Parent Document Retriever

### LLM Response Cache (6 типов)

Кешируют **полный ответ LLM по hash от input**. Если инпут совпал — возвращают закешированный output без обращения к провайдеру. Подключаются к input-порту `Cache` у LLM-ноды (например ChatAnthropic, ChatOpenAI).

| Тип | Хранение | Persistence | Use case |
|---|---|---|---|
| **InMemory Cache** | RAM Flowise-процесса | ❌ теряется при рестарте | Быстрые dev-итерации |
| **Redis Cache** | Redis (self-hosted) | ✅ TTL | Prod, single-region |
| **Upstash Redis Cache** | Upstash (managed) | ✅ | Prod, serverless-friendly |
| **Momento Cache** | Momento (managed serverless cache) | ✅ | Prod, globally distributed |
| **InMemory Embedding Cache** | RAM, для embedding результатов | ❌ | Dedupe embed-вызовов в рамках одной сессии |
| **Redis Embedding Cache** | Redis, для embedding результатов | ✅ | Prod dedupe эмбеддингов |

**Важно:** это **не** Claude `cache_control`. Это кеш **ответов** на уровне Flowise. Экономия 100% токенов **только** при идентичных input'ах (тот же system + тот же user message). Если поменялся хоть один символ в user части — кеш не сработает.

**Useful для:**
- **FAQ-сценарии** — одни и те же вопросы от разных юзеров (при условии что мы не нормализуем sessionId в hash-ключ)
- **Идемпотентные трансформации** (category classification, NER, fixed-template summarization)
- **Dedupe embedding вызовов** — если тот же текст приходит дважды, не платим OpenAI второй раз

**Не useful для:**
- RAG Q&A — разные вопросы, даже по одному источнику, дают разный hash
- Conversational chat — история в input меняется каждое сообщение

### LLM: Claude `cache_control` (Anthropic prompt caching)

**Проверено в эксперименте A (2026-04-23):** в `ChatAnthropic` ноде Flowise 3.1.2 **штатного поля для `cache_control` нет**. Additional Parameters содержат: Streaming, Extended Thinking (reasoning mode для Claude Sonnet 3.7 / Claude 4), Max Tokens, Top P, Top K.

**Как инжектить:** для cache-heavy путей (длинный system prompt или большой retrieved context, который повторяется между запросами) пишем тонкий сервис в NestJS с `@anthropic-ai/sdk` напрямую + `cache_control: { type: 'ephemeral' }`. Для остального — через Flowise как обычно.

### Speech-to-Text в embedded-чате

Chatflow Configuration → **Speech To Text** — транскрибация голосовых сообщений **внутри** Flowise-чата в real-time. Провайдеры:

- **OpenAI Whisper** — через OpenAI API
- **Groq Whisper** — быстрый и дешёвый (у нас уже используется в батче, ключ будет готов)
- **Assembly AI**
- **LocalAI STT** — self-hosted
- **Azure Cognitive Services**

Применение для slovo: в Phase 3 Q&A-чат пользователь сможет **говорить голосом**, не печатать. Ноль кода — галочка в Chatflow Config. **Но работает только с short voice-message, не с upload'ом большого видео** — для batch-ingestion нужен наш worker, см. раздел «Batch-транскрибация» ниже.

### Text-to-Speech

Тоже в Chatflow Configuration — озвучка ответов LLM. Провайдеры: OpenAI TTS, ElevenLabs, Azure TTS, LocalAI. Опционально для Phase 3 если захочется voice-ответы.

### LLM: Claude Extended Thinking (reasoning)

В `ChatAnthropic` ноде есть toggle **Extended Thinking** — включает chain-of-thought reasoning mode для Claude Sonnet 3.7+ / Claude 4. Модель «думает» перед ответом, это даёт лучшее качество на сложных задачах (анализ, multi-step логика).

**Полезно для:** water-analysis (лабораторные показатели → рекомендации), SEO-генерация с жёсткими правилами, structured extraction из транскриптов.

### MCP — Model Context Protocol

**Flowise — хороший MCP-клиент.** Готовые интеграции:

- **Custom MCP** — любой MCP-сервер по stdio / HTTP / SSE
- **PostgreSQL MCP** — SELECT к БД как tool
- **GitHub MCP** — работа с репозиториями
- **Slack MCP** — отправка сообщений
- **Browserless MCP** (добавлен в 3.1.2) — headless браузер
- **Brave Search MCP** — веб-поиск
- **Pipedream MCP** (добавлен в 3.1.2) — 2000+ готовых интеграций
- **Supergateway MCP** — stdio ↔ HTTP/SSE прокси

### Prediction API и streaming

- `POST /api/v1/prediction/{chatflowId}` — основной endpoint
- Body: `question`, `streaming`, `overrideConfig`, `history`, `uploads`
- **Real SSE streaming** в 3.x (в 2.x был псевдо) — токены идут по мере генерации
- Structured Output Parser автоматически отключает streaming (нельзя валидировать partial JSON)

### Observability — Langfuse native

- Включается в UI: Chatflow settings → Analyse Chatflow → Langfuse
- Auto-tracing: LLM-вызовы, retrievals, tool use, timings, cost
- Поддерживаются также LunaryAI, Langsmith, LangWatch, Arize, Phoenix, Opik

### Admin / deployment

- Workspaces (разделение chatflow по командам)
- Per-chatflow API keys
- Export/import chatflow как JSON — можно хранить в git
- SQLite (dev) / MySQL / PostgreSQL (prod) для persistence самого Flowise

---

## ❌ Чего Flowise НЕ умеет (нужно инжектить)

### 1. Batch-транскрибация больших видео/аудио — **нет, критично**

**Важное уточнение (2026-04-23):** в Flowise 3.1.2 **есть** встроенный **Speech-to-Text** в Chatflow Configuration с провайдерами **OpenAI Whisper, Groq Whisper, Assembly AI, LocalAI STT, Azure Cognitive Services**. Но это **live voice input для embedded-чата**, не batch-ingestion.

| Сценарий | Подходит Flowise Speech-to-Text? |
|---|---|
| Юзер нажимает микрофон в Flowise-чате → записывает короткий voice-question 10-30 секунд → Flowise транскрибирует on-the-fly → LLM отвечает | ✅ Да, встроено одной галочкой в Chatflow Config → Speech To Text |
| Юзер загружает 2-часовой вебинар → нужно фоново транскрибировать, вернуть прогресс, сохранить в knowledge base | ❌ Нет — sync HTTP-запрос, timeout ~30s, весь аудио-буфер в RAM Flowise-процесса, нет retry/fallback, нет прогресса для клиента |

**Для slovo:**
- **Live voice Q&A по knowledge base** (Phase 3) → используем встроенный Flowise Speech-to-Text с Groq Whisper. Ноль кода.
- **Batch ingestion видео/аудио для knowledge base** (Phase 2) → обязателен собственный NestJS worker + RMQ. Без этого большие файлы ляжут.

**Как инжектить batch-pipeline:** NestJS worker делает транскрибацию (retry/fallback, chunking, прогресс), Flowise получает уже готовый `extractedText` через Vector Upsert API.

```
Video upload (S3/MinIO)
  ↓
NestJS worker (apps/worker)
  ├─ FFmpeg → audio extraction
  ├─ Chunk на 20-мин отрезки
  ├─ Groq Whisper API (retry/fallback из video-transcriber/transcribe.js)
  └─ extractedText
      ↓
POST /api/v1/vector/upsert/{chatflowId}  [Flowise принимает уже готовый text]
  ↓
Flowise: Text Splitter → Embeddings → pgvector
```

Соответствующий адаптер в нашем коде: `libs/ingest/adapters/video/` и `libs/ingest/transcription/groq-whisper.service.ts`.

### 2. Prompt caching для Claude — **не документировано**

**Критично для slovo экономически.** Claude `cache_control: { type: 'ephemeral' }` даёт 90% скидку на повторяющемся system prompt. В UI Flowise 3.x в `ChatAnthropic` ноде этого не видно.

**Сценарии ответа после эксперимента A:**

- **(A1) Есть скрытое поле в Additional Parameters** — используем штатно.
- **(A2) Нет — можно через Custom JS Function node** с прямым вызовом `@anthropic-ai/sdk` и ручной настройкой cache_control.
- **(A3) Совсем нет —** для caching-критичных путей (system prompt >1024 токенов) пишем отдельный NestJS-сервис через Claude SDK напрямую. Гибрид: Flowise для обычных chatflow, NestJS для cache-heavy.

### 3. Long-running async jobs — нет worker-примитивов

Flowise работает **синхронно через Prediction API**. Таймаут по умолчанию ~30 сек. Транскрибация 2-часового видео никак не впишется.

**Как инжектить:** RabbitMQ worker в NestJS (`apps/worker/`). Процесс:

```
POST /knowledge/sources (multipart video)
  ↓ NestJS API
  ├─ Upload в S3 → storageKey
  ├─ INSERT KnowledgeSource (status=pending)
  ├─ Publish в RMQ queue 'knowledge-ingestion'
  └─ Response 202 Accepted {id, status: 'pending'}

RMQ consumer (apps/worker):
  ├─ Download S3 → temp
  ├─ FFmpeg → audio chunks
  ├─ Groq Whisper (retry/fallback)
  ├─ extractedText
  ├─ UPDATE KnowledgeSource (status=processing, progress=80)
  ├─ POST /api/v1/vector/upsert/{chatflowId} → Flowise
  └─ UPDATE KnowledgeSource (status=ready, progress=100)

GET /knowledge/sources/:id → клиент поллит статус
```

### 4. Multi-tenant data isolation на уровне vector store — не автомат

Flowise pgvector-retriever **не фильтрует автоматически по пользователю**. Chunks всех юзеров лежат в одной таблице.

**Как инжектить:** добавляем `user_id` в `metadata` каждого chunk при upsert, в chatflow retriever ставим metadata filter `{ user_id: {{vars.user_id}} }`. `user_id` передаём через `overrideConfig.vars`.

### 5. Rate limiting на API-уровне — минимальный

Flowise не даёт гранулярного rate-limit (per-user / per-endpoint).

**Как инжектить:** `@nestjs/throttler` в слое NestJS. Клиент **не** ходит в Flowise напрямую, только через наш API.

### 6. User management / JWT auth — нет

Flowise workspaces и API keys — это для admin-уровня, не для end-user auth.

**Как инжектить:** NestJS guards + JWT. Клиент → JWT в header → NestJS auth → `userId` в request → формирует `sessionId = userId` для Flowise.

### 7. Кастомная pre-processing логика ingestion — ограниченная

Flowise Document Loaders generic: валидация контента, normalization, PII-стрипинг — в коробке нет.

**Как инжектить:** NestJS pre-processing между S3 и Flowise upsert. Пример: расшифровали видео → прогнали через регэксп-редактор PII → отправили во Flowise.

---

## Доступ из Docker к Anthropic/OpenAI через HTTP-прокси (RU-окружение)

### Проблема

Docker Desktop на Windows использует WSL2 со своим сетевым стеком, **системный VPN/прокси Windows не захватывает outbound-трафик контейнеров**. Anthropic/OpenAI из РФ-IP возвращают `403 Forbidden`. Нужно настроить proxy **внутри контейнера**.

### Осложнение: Node.js fetch (undici) не читает `HTTP_PROXY`

Переменные `HTTP_PROXY`/`HTTPS_PROXY` читает GNU wget, curl, Python requests — но **не Node.js fetch через undici**. LangChain / `@anthropic-ai/sdk` в Flowise используют именно undici. Просто прокинуть env-vars недостаточно.

### Решение — monkey-patch через preload

`docker/flowise-proxy-bootstrap.cjs` на старте Node.js настраивает глобальный `undici.setGlobalDispatcher(new ProxyAgent(HTTPS_PROXY))`. Подключается через `NODE_OPTIONS="--require /scripts/flowise-proxy-bootstrap.cjs"`.

```yaml
# docker-compose.infra.yml
flowise:
    environment:
        HTTP_PROXY: ${HOST_HTTP_PROXY:-http://host.docker.internal:10810}
        HTTPS_PROXY: ${HOST_HTTP_PROXY:-http://host.docker.internal:10810}
        NO_PROXY: localhost,127.0.0.1,slovo-postgres,slovo-valkey,...
        NODE_OPTIONS: --require /scripts/flowise-proxy-bootstrap.cjs
    extra_hosts:
        - "host.docker.internal:host-gateway"
    volumes:
        - ./docker/flowise-proxy-bootstrap.cjs:/scripts/flowise-proxy-bootstrap.cjs:ro
```

**Предусловие:** на хосте должен крутиться HTTP-прокси (tinyproxy/privoxy/winhttpproxy — конвертирует SOCKS/WireGuard → HTTP CONNECT). Пример: `tinyproxy` на `127.0.0.1:10810`, upstream — SSH-туннель до VPS в Европе.

### Проверка что работает

```bash
# Должен вернуть IP-прокси (Frankfurt), не IP РФ
docker exec slovo-flowise node -e "fetch('https://api.ipify.org').then(r=>r.text()).then(console.log)"
```

Для prod-окружения (когда сервер сам в EU/US datacenter) — proxy не нужен, убираем эти env-vars и volume-mount.

---

## Эксперименты для финализации ADR-006

### ✅ A. `cache_control` в ChatAnthropic — ЗАКРЫТ (2026-04-23)

**Проверено в UI Flowise 3.1.2:** Additional Parameters ноды ChatAnthropic содержат только Streaming, Extended Thinking, Max Tokens, Top P, Top K. Поля `cache_control` нет.

**Решение: A3 — гибрид.** Для cache-heavy путей (длинный system prompt или большой retrieved context, повторяющийся между запросами) — NestJS wrapper через `@anthropic-ai/sdk` с `cache_control: { type: 'ephemeral' }`. Для прочих LLM-вызовов — Flowise ChatAnthropic как обычно.

**Бонус находка:** Flowise LLM Response Cache (6 типов) через input-порт `Cache` — полезен для FAQ-паттернов и dedupe эмбеддингов. Подробности в разделе «LLM Response Cache» выше.

### ✅ B. `overrideConfig.promptValues` — РАЗОБРАНО ДО КОРНЯ (2026-04-23)

Потратили час чтобы разобраться до механики, включая чтение исходника
Flowise (`packages/components/nodes/chains/LLMChain/LLMChain.ts`):

```typescript
let promptValues = nodeData.inputs?.prompt.promptValues as ICommonObject
const options = {
    ...promptValues,           // partial vars из UI ноды Prompt Template
    [lastValue]: input         // поле `question` API → ПОСЛЕДНЯЯ переменная шаблона
}
```

**Главный вывод:** для **LLM Chain** `overrideConfig.promptValues` из API **не читается** на уровне кода. Toggle в Security → Override Configuration для `promptValues` ничего не меняет — код ноды LLMChain.ts просто его не смотрит. Это unimplemented feature конкретно для LLM Chain.

**Что реально происходит с LLM Chain:**
- `question` в API → **auto-маппинг в последнюю переменную шаблона** (любое имя: `{input}`, `{topic}`, etc.) через `[lastValue]: input`
- Partial vars задаются **только** в UI ноды Prompt Template → поле **Format Prompt Values**
- Всё. API override `promptValues` для LLM Chain — в никуда

**Как поведение проявлялось в нашем тесте:**

| Шаг | Что делали | Что получили |
|---|---|---|
| 1 | `promptValues: {input: "..."}`, Template с `{input}` | Claude отвечал про `question` (он был `"ignored-raw-input"`) — `input` вары были проигнорированы |
| 2 | То же самое с `{topic}` | Claude отвечал про `question` = "ignored" (подставленного в `{topic}` автоматически) — отсюда Мальта/Керамика/Вышгород (галлюцинации на "Расскажи коротко про: ignored") |
| 3 | Очистили Format Prompt Values в ноде | То же самое (ничего не поменялось — `[lastValue]: input` всегда побеждает) |

**Что работает в ДРУГИХ chain-нодах** (по коду + issue #2991):

| Chain-тип | `overrideConfig.promptValues` работает? |
|---|---|
| **LLM Chain** | ❌ Не читается из API, только UI-значения |
| **Conversational Retrieval QA Chain** | ✅ Работает (именно этот мы будем использовать в slovo) |
| **Tool Agent** | ✅ Работает (код в `ToolAgent.ts` обрабатывает) |
| **Conversation Chain** | ✅ Работает |
| **Worker** (multi-agent) | ✅ Работает |

### Практическая матрица для slovo

| Use case | Решение |
|---|---|
| **Единственная переменная user-ввода** (Q&A вопрос, короткая фраза) | Через `question` в API → **auto-map в последнюю переменную** шаблона. Работает везде на всех chain. Самый простой путь. |
| **Dynamic vars в system prompt** (language, tenant_id, persona, style) | `overrideConfig.promptValues` + **Conversational Retrieval QA Chain** (НЕ LLM Chain) + включённый toggle в Security → Override Configuration. Работает. |
| **LLM Chain с несколькими vars** (редкий/устаревший паттерн) | Либо не используем LLM Chain (берём Conversation Chain), либо склеиваем в `question` форматированным текстом как в `test-marpla/backend/src/seo/seo.service.ts`. |
| **Полностью переопределить промпт** | В Security включить `Template` toggle у Prompt Template ноды и передавать `overrideConfig.template` — это работает для LLM Chain тоже |

**Вывод:** не баг, а специфика конкретной ноды. Для production slovo это не мешает — **Conversational Retrieval QA Chain это наш рабочий инструмент**, там `promptValues` из API подхватывается нормально. LLM Chain — legacy, не используем.

### ❓ C. Postgres vector store — схема колонок

Создать тестовую таблицу с колонками, которые ожидает LangChain PGVector store (вероятно `id UUID`, `content TEXT`, `metadata JSONB`, `embedding VECTOR(1536)`). Подключить Postgres-ноду в Flowise → прогнать upsert → посмотреть как данные легли. Решит: (a) переименовать колонки в Prisma-модели `KnowledgeChunk` под Flowise-дефолт, или (b) сделать `VIEW knowledge_chunks_flowise` как адаптер над нашей таблицей.

---

## Архитектурная картина для slovo

```
┌─────────────────────────────────────────────────────┐
│              Client (frontend / CLI / API)         │
└──────────────────────┬──────────────────────────────┘
                       ↓ HTTPS + JWT
┌─────────────────────────────────────────────────────┐
│         NestJS (apps/api + apps/worker)             │
│                                                     │
│  ┌─ auth, multi-tenant, rate limit (throttler)      │
│  ├─ CRUD: KnowledgeSource метаданные (Prisma)       │
│  ├─ Ingestion:                                      │
│  │   video/audio → S3 → RMQ → worker                │
│  │   worker: FFmpeg + Groq Whisper → extractedText  │
│  │   worker forwards text → Flowise Upsert API      │
│  ├─ Prompt caching обёртка (если тест A провалится) │
│  ├─ Custom MCP-серверы для domain-функций           │
│  └─ HTTP-клиент к Flowise Prediction API            │
└──────────────────────┬──────────────────────────────┘
                       ↓ HTTP (internal network)
┌─────────────────────────────────────────────────────┐
│              Flowise 3.1.2 (127.0.0.1:3130)         │
│                                                     │
│  ┌─ Chatflows: upsert / qa / conversational-qa /    │
│  │              domain-specific (seo, water, и т.д.)│
│  ├─ Text Splitters + Embeddings                     │
│  ├─ Postgres pgvector node → slovo-postgres         │
│  ├─ Retrievers (top-K, MMR, MultiQuery)             │
│  ├─ Memory: PostgreSQL Chat Memory (slovo-postgres) │
│  ├─ LLM: ChatAnthropic (primary), OpenAI, Ollama    │
│  ├─ MCP Client → NestJS MCP-серверы (custom tools)  │
│  └─ Langfuse tracing (auto)                         │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────┐
│  Infrastructure                                     │
│  • slovo-postgres (pgvector: knowledge_chunks       │
│                     + chat_memory)                  │
│  • slovo-valkey (кеш, session cache, RMQ-less put)  │
│  • slovo-rabbitmq (async ingestion jobs)            │
│  • slovo-flowise (orchestration runtime)            │
│  • slovo-langfuse (observability)                   │
│  • MinIO/S3 (blob storage — видео/аудио/PDF)        │
└─────────────────────────────────────────────────────┘
```

---

## Чек-лист «Flowise vs NestJS» для новой задачи

Когда появляется новая фича, задавай вопросы в этом порядке:

1. **Есть ли LLM-работа?** Chain/agent/tool use / embedding / retrieval → **Flowise chatflow.**
2. **Нужно обработать аудио/видео?** → **NestJS worker** (Groq Whisper через `libs/ingest/`).
3. **System prompt длинный (>1024 токенов) и повторяется?** → либо Flowise с cache_control (если тест A покажет что можно), либо NestJS обёртка с Claude SDK.
4. **Нужен real-time прогресс/SSE / long-running?** → NestJS API + worker, Flowise как downstream.
5. **Custom tool/функция домена?** → NestJS expose как MCP-сервер, Flowise-агент использует через MCP client node.
6. **Multi-tenant фильтр данных?** → NestJS передаёт `userId` в `overrideConfig.vars`, Flowise retriever фильтрует по metadata.
7. **Нужно логирование/метрики/cost-tracking?** → Langfuse включается одной галочкой в Flowise UI.

---

## Gotchas и подводные камни

- **Postgres node не создаёт таблиц** — создавайте Prisma-миграцией заранее.
- **HNSW/IVFFlat индекс** на vector-колонке создаётся вручным SQL в миграции через `migrate dev --create-only` (см. ADR-005).
- **Streaming + Structured Output Parser** несовместимы — или/или.
- **Tool Agent требует Memory** — даже если её не используешь, добавь Buffer Memory, иначе ошибка (из тьюториала 2.x, в 3.x скорее всего то же).
- **Chunk size в символах**, не в токенах. 1 токен ≈ 4 символа. 500 токенов ≈ 2000 символов.
- **Vectors от разных embedding-моделей несовместимы** — смена модели = re-embed всех chunks.
- **`overrideConfig.promptValues`** — требует эксперимента B. Если сломан — обходим через форматированный `question`.
- **Export chatflow JSON** — один большой `flowData` JSON, плохо читается в git diff. Храним в `flowise/chatflows/*.json`, но версионирование на уровне комментариев/PR-описаний.

---

## Ссылки

- Release notes Flowise: https://github.com/FlowiseAI/Flowise/releases
- Docs index: https://docs.flowiseai.com/sitemap
- Prediction API: https://docs.flowiseai.com/api-reference/prediction
- Vector Upsert API: https://docs.flowiseai.com/api-reference/vector-upsert
- Memory types: https://docs.flowiseai.com/integrations/langchain/memory
- Postgres vector: https://docs.flowiseai.com/integrations/langchain/vector-stores/postgres
- Analytics/Langfuse: https://docs.flowiseai.com/using-flowise/analytics
- ADR-006 — решение использовать Flowise как runtime
- Тьюториал разработчика (2.x, исторический): `C:\Users\Diamond\Desktop\test-marpla\docs\tutorial\`
