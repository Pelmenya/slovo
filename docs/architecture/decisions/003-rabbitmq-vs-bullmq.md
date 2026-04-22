# ADR-003: RabbitMQ для асинхронных задач

## Статус
✅ Принято — 2026-04-22

## Контекст

LLM-операции долгие и дорогие:

- Генерация текста: 3-30 секунд
- Vision-анализ: 5-20 секунд
- Embeddings большого корпуса: минуты-часы
- Fine-tuning: часы

Синхронные HTTP-запросы не подходят — клиент не должен держать соединение. Нужна очередь задач.

Варианты:

1. **BullMQ** (на Valkey/Redis) — популярный в Node.js
2. **RabbitMQ** (стандарт в enterprise)
3. **AWS SQS** / **Google Pub/Sub** — managed
4. **Kafka** — streaming / event sourcing

## Решение

**RabbitMQ 4.2** с NestJS microservices.

## Альтернативы

### BullMQ

Плюсы:
- Нативный Node.js — простая установка
- Уже есть Valkey в стеке (работает поверх Redis)
- Хороший DX, типизация
- `@nestjs/bullmq` интеграция

Минусы:
- ⚠️ **Только Node.js** — если появится Python-сервис, нужно поверх AMQP
- ⚠️ Весь стейт в Redis — нет persistence гарантий на уровне AMQP
- ⚠️ Маршрутизация простая (key → queue), без exchange patterns
- ⚠️ Не industry standard — меньше tooling/мониторинга

### RabbitMQ

Плюсы:
- **Industry standard** — знают все разработчики
- **AMQP протокол** — любой язык работает (Python, Go, Java, Rust)
- **Advanced routing** — topic / fanout / direct / headers exchange
- **Management UI** — из коробки (5 минут → видно что происходит)
- **Retry / DLQ** — встроенные паттерны
- **Cluster support** — горизонтальное масштабирование
- **Priorities, TTL, scheduled messages** — зрелый функционал
- **NestJS microservices** — нативная поддержка через `Transport.RMQ`

Минусы:
- ⚠️ +1 сервис в инфраструктуре
- ⚠️ Сложнее DX чем BullMQ (но не критично)

### AWS SQS / Google Pub/Sub

Минусы:
- ❌ Vendor lock-in
- ❌ Дорого на масштабе
- ❌ Нет удобного локального dev (LocalStack — не то же самое)

### Apache Kafka

Плюсы:
- Event sourcing, replay
- Высочайшая пропускная способность

Минусы:
- ❌ **Overkill** для нашего кейса (пара тысяч сообщений в секунду — потолок)
- ❌ Операционная сложность (ZooKeeper, топики, партиции)
- ❌ Не задачи, а event streams — другая модель

## Последствия

### Плюсы

- ✅ **Language-agnostic** — будущий Python-микросервис подключится без проблем
- ✅ **Production-ready паттерны** — DLQ, retry, priority из коробки
- ✅ **Management UI** — видимость процесса
- ✅ **Прокачка скилла** — RabbitMQ в резюме весомее чем BullMQ
- ✅ **NestJS нативная интеграция** — `Transport.RMQ`, декораторы `@MessagePattern()`
- ✅ **Отделяет кэш от очередей** — Valkey для кэша, RabbitMQ для задач (single responsibility)

### Минусы

- ⚠️ +1 Docker-контейнер в dev/prod
- ⚠️ Нужно знать AMQP-терминологию (exchange, queue, binding, routing key)

### Паттерны использования

**Простые задачи (без ответа):**
```typescript
@MessagePattern('water.analyze')
async analyzeWater(@Payload() dto: AnalyzeDto) { ... }
```

**Задачи с ответом (RPC):**
```typescript
const result = await this.client.send('water.analyze', dto).toPromise();
```

**Долгие задачи с progress:**
```typescript
@MessagePattern('water.analyze.start')
async startAnalysis(@Payload() dto) {
    const jobId = uuid();
    // kick off background work, emit progress events
    return { jobId };
}

@EventPattern('water.analyze.progress')
async onProgress(@Payload() event) { /* WebSocket push */ }
```

### Когда пересмотреть

- Появится критичная потребность в event sourcing / replay → Kafka
- Нагрузка > 100k сообщений/сек → Kafka
- Команда предпочитает managed → SQS/Pub/Sub

Для SaaS-платформы под несколько тысяч клиентов RabbitMQ хватит с запасом.
