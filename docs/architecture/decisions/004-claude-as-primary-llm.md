# ADR-004: Claude как основная LLM

## Статус
✅ Принято — 2026-04-22

## Контекст

Платформа интегрируется с LLM-провайдерами для генерации, анализа, RAG. Нужно выбрать основную модель.

Варианты:

1. **Claude** (Anthropic)
2. **GPT-4o / GPT-4o-mini** (OpenAI)
3. **Gemini** (Google)
4. **Local models** (Llama, Qwen, Mistral через Ollama)
5. **Multi-provider** (abstraction + runtime switch)

## Решение

**Claude как primary**, abstraction-слой под сменщиков провайдера:

- `claude-sonnet-4-6` — основная генерация
- `claude-haiku-4-5` — быстрые/дешёвые операции
- Vision через Claude Vision

OpenAI / Ollama подключаются через тот же `TLLMProvider` тип.

## Альтернативы

### GPT-4o

Плюсы:
- Industry leader по узнаваемости
- Огромная экосистема (LangChain, autogen, инструменты)
- Function calling — эталон, часто задаёт стандарт

Минусы:
- ⚠️ На сложных инструкциях следует хуже Claude 3.5+
- ⚠️ Галлюцинации выше по бенчмаркам 2025-2026
- ⚠️ Для русского — хороший, но Claude nativelier

### Gemini

Плюсы:
- Больший контекст (2M у Pro)
- Дешёвый Flash-вариант

Минусы:
- ⚠️ Менее стабильный function calling
- ⚠️ Экосистема младше
- ⚠️ Интеграция через Google Cloud — сложнее

### Local (Ollama + Qwen / Llama)

Плюсы:
- Приватность
- Бесплатно

Минусы:
- ❌ **Качество ниже** — на сложных задачах (CTE SQL, структурированные ответы)
- ❌ **Инфра тяжёлая** — GPU-сервер нужен
- ❌ Под пиковую нагрузку не масштабируется (1 GPU = 1 запрос)

Используем для dev / privacy-критичных кейсов, не для основной нагрузки.

### Multi-provider с первого дня

Минусы:
- ⚠️ **Premature optimization** — абстракция под 3 провайдера без понимания где какой лучше
- ⚠️ Разные capabilities (structured output, vision, streaming) — lowest common denominator

## Почему Claude

### Технические причины

- **Лучшее следование инструкциям** — критично для structured output и RAG
- **Vision** — качественно, нужен для анализа фото (water-analysis, product-images)
- **Contextual understanding** — понимает длинные документы без потери
- **Native Anthropic SDK** для TypeScript
- **Structured output (tools)** — нативно, без хаков
- **Русский язык** — качественный, читаемая генерация

### Экономические причины

- **Claude Max подписка** у разработчика = фиксированная стоимость
- Через API — сопоставимо с GPT-4 по цене
- Haiku 4.5 — дёшев для быстрых операций

### Стратегические причины

- **Anthropic** — чётко ориентированы на responsible AI, alignment
- **MCP** (Model Context Protocol) — их стандарт, расширяется
- Хорошее соответствие SaaS-этике (наша платформа — не для generated spam)

## Последствия

### Плюсы

- ✅ Высокое качество по умолчанию
- ✅ Меньше итераций по промптам
- ✅ Vision из коробки
- ✅ Известная компания (доверие клиентов SaaS)
- ✅ MCP-совместимость на будущее

### Минусы

- ⚠️ Меньше сообщества в RU (GPT-4 популярнее в дев-блогах)
- ⚠️ SDK младше OpenAI (меньше utility-библиотек)
- ⚠️ Zero-downtime переключение провайдера требует абстракции

### Абстракция

```typescript
// libs/llm/src/providers/claude.provider.ts
// libs/llm/src/providers/openai.provider.ts
// libs/llm/src/providers/ollama.provider.ts

type TLLMProvider = {
    generate(req: TLLMRequest): Promise<TLLMResponse>;
    stream(req: TLLMRequest): AsyncIterable<TLLMChunk>;
    embed(text: string): Promise<number[]>;
};
```

Per-feature конфиг:
```typescript
{
  "features.water-analysis.provider": "claude",
  "features.notes-rag.embedding-provider": "openai",
  "features.dev-sandbox.provider": "ollama"
}
```

### Когда пересмотреть

- Anthropic повышает цены > +50%
- Claude деградирует по качеству
- OpenAI выпускает модель с явно лучшим function calling
- Появится нужда в embeddings-модели дешевле OpenAI (тогда Cohere/local)
