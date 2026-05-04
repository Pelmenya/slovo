# Flowise — конвенции нейминга ресурсов

> **Статус:** Active (2026-05-04)
> **Связано:** [flowise-vs-nestjs.md](flowise-vs-nestjs.md), [ADR-008 Flowise MCP](../architecture/decisions/008-flowise-mcp.md)
> **Применимо к:** Chatflows, Document Stores, Credentials, Variables, Custom Tools

---

## Зачем

При росте инстанса Flowise (на момент 2026-05-04 у нас 2 chatflow'а, к концу 2026 ожидается 8-15) без единой схемы имена расходятся. Реальный пример из май 2026:

```
catalog-vision-augmenter-v1   ← domain catalog, modifier vision
vision-catalog-describer-v1   ← modifier vision, domain catalog
```

Порядок токенов разный — сортировка по имени не группирует по домену, поиск по префиксу `catalog-` пропускает второй. Один формат закрывает эту проблему сразу и навсегда.

Дополнительные мотивации:
- **Trace-attribution в Langfuse** — имена chatflow'ов попадают в трейсы. Чем системнее имя — тем легче фильтровать дашборды по домену.
- **MCP-инструменты для других сессий и AI-агентов** — `flowise_chatflow_list` возвращает их именами. Согласованный формат = меньше вопросов «а что такое X?».

---

## Chatflows и AgentFlows

**Формат: `<domain>-<task>[-<modifier>]-<version>`**

| Часть | Что | Обязательность |
|---|---|---|
| `<domain>` | Бизнес-домен: `catalog`, `water-analysis`, `knowledge-base`, `notes`, `support` | Обязательно, **первое слово** |
| `<task>` | Что делает: `extractor`, `augmenter`, `describer`, `classifier`, `summarizer`, `recommender`, `router`, `qa`, `chat`, `assistant` | Обязательно |
| `<modifier>` | Уточнение реализации: `vision`, `text`, `tool-agent`, `streaming` | Только если из task неочевидно ИЛИ существуют параллельные варианты (`-vision-` и `-text-` для одной task) |
| `<version>` | `v1`, `v2`, ... — инкрементальный, не семвер, не дата | Обязательно |

**Правила:**

- **lowercase, kebab-case, ASCII** — никаких пробелов, кириллицы, заглавных, точек
- **Singular** — `catalog-augmenter`, не `catalog-augmenters`
- **Task — существительное на `-er`/`-or`** (стабильнее глаголов): `extractor`, не `extract`. Исключение — устоявшиеся короткие сущности: `chat`, `qa`, `assistant`
- **Domain первым словом всегда** — это якорь визуального scan'а, сортировки, фильтрации. Нарушение этого правила и привело к хаосу примера выше
- **Version всегда `-vN`** в конце, без точек/префиксов: `v1`, не `1.0`/`v1.0`/`-2026-05`
- **v1 не удаляем** при выкатке v2 — держим живым пока v2 не доказал стабильность в проде. После — удаляем v1 явно через `flowise_chatflow_delete`

---

## Применение к существующим chatflow'ам (2026-05-04)

| Сейчас | Должно быть | Почему |
|---|---|---|
| `catalog-vision-augmenter-v1` | `catalog-augmenter-vision-v1` | domain первый, modifier перед version |
| `vision-catalog-describer-v1` | `catalog-describer-vision-v1` | то же |

**Переименование** — через `flowise_chatflow_update` (MCP). Chatflow ID остаётся тем же, имя меняется — slovo-код, который дёргает chatflow'ы по ID, не ломается. **Ломается** только имя в Langfuse-трейсах после переименования (старые трейсы остаются под старым именем — это ок, новые пишутся под новым).

---

## Document Stores

**Формат: `<domain>-<source>`** — без version, store обычно один на домен.

| Пример | Домен / источник |
|---|---|
| `catalog-aquaphor` | каталог Аквафор Pro |
| `knowledge-base-text` | text-источники Knowledge Base Phase 1 |
| `knowledge-base-video` | (будущий) video-источники Phase 2 |

Если когда-то понадобится несколько stores на один домен — добавляем суффикс: `catalog-aquaphor-products`, `catalog-aquaphor-manuals`.

---

## Credentials

**Формат: `<provider>-<env>`**

| Пример | Что |
|---|---|
| `anthropic-prod` | Anthropic API key, prod-инстанс |
| `openai-prod` | OpenAI API key, prod-инстанс |
| `cohere-prod` | Cohere |
| `postgres-slovo` | Postgres connection string для pgvector |
| `minio-experiments` | MinIO для экспериментов |

При появлении staging/dev инстансов — `anthropic-staging`, `anthropic-dev`. Сейчас один env (prod), но формат закладывает будущее.

---

## Variables

**Формат: `UPPER_SNAKE_CASE`** (как env vars).

| Пример | Что |
|---|---|
| `WATER_ANALYSIS_BUDGET_USD` | бюджет на extraction в этапе 1 |
| `CATALOG_VISION_DAILY_CAP_USD` | дневной лимит vision augmenter'а |
| `DEFAULT_EMBEDDING_MODEL` | модель эмбеддингов по умолчанию |

Можно добавлять префикс домена для группировки в UI: `WATER_ANALYSIS_*`, `CATALOG_*`.

---

## Custom Tools

**Формат: `<domain>-<action>`** — kebab-case, как chatflow'ы, но без `<task>`-`<version>` (custom tools обычно стабильнее, версии не нужны).

| Пример | Что |
|---|---|
| `catalog-search-by-image` | поиск по каталогу по фото товара |
| `water-analysis-fetch-similar` | подбор похожих анализов |
| `crm-create-lead` | создание лида в CRM |

Если custom tool радикально меняет signature — создаём новый с суффиксом `-v2`, старый постепенно мигрируем.

---

## Что мы **не** предписываем

- **Display name внутри node'ы** в graph'е chatflow'а — оставляем дефолтные `chatAnthropic_0`, `advancedStructuredOutputParser_0`. Менять не нужно: они уникальные внутри одного chatflow'а, наружу не светятся
- **Эмодзи в описаниях** chatflow'ов в UI — допустимо если помогает scan'у в списке. На имена правило не распространяется (имена строго ASCII)
- **Длину имени** — нет жёсткого лимита, но >40 символов плохо отображается в UI Chatflows-листа. Если имя длиннее — пересмотри какие модификаторы реально нужны

---

## Чеклист при создании нового ресурса

1. **Domain выбран и совпадает с существующими?** Если фича новая — проверь что domain не совпадает с существующим под другим смыслом (`catalog` уже занят Аквафором, для каталога другого вендора → `catalog-prosvet`)
2. **Task — `-er`/`-or` существительное** (не глагол)?
3. **Modifier нужен?** Только если параллельно есть другая реализация той же task ИЛИ из task неясно (`vision` vs `text` extraction)
4. **Version `-v1`** на старте; не пропускай (даже если первая версия)
5. Прогнал `flowise_chatflow_list` / `flowise_introspect` — нет конфликта с существующим именем?
