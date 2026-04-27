# ADR-007: Catalog ingest contract — file-based pull через shared MinIO bucket

## Статус
✅ Принято — 2026-04-27 (после реализации feeder'а в `crm-aqua-kinetics-back`, коммиты `148194f` / `da99f92` / `66cec69`)

## Контекст

slovo планирует semantic-каталог-поиск (фича `vision-catalog-search`). Каталог наполняется внешними системами (CRM, 1С, ручной импорт), сами по себе домен-агностичны для slovo.

Первый feeder — `crm-aqua-kinetics-back` — уже имеет интеграцию с MoySklad: знает System Bundle pattern, парсит услуги/расходники из атрибутов, кэширует в Redis. slovo не должен про это знать (generic-catalog принцип, см. `vision-catalog-search.md` секция «Развёртывание»).

В первой версии плана (`docs/features/vision-catalog-search.md` v1) контракт описывался как **HTTP push:**

```
crm → POST /catalog/items/bulk → slovo (ApiKeyGuard)
```

При реализации feeder'а в CRM выявились проблемы push-варианта:

1. **Tight coupling по availability** — если slovo лежит/перезагружается, cache-reset CRM падает или висит на retry. Cache-reset для CRM — критичная операция (синхронизация с MoySklad после ручного refresh админа), не должна зависеть от статуса AI-сервиса.
2. **Нет аудита** — после успешного push'а исходный snapshot теряется. При багах в slovo (некорректный парсинг, потерянные товары) — нечем восстановить.
3. **Каждый новый feeder требует кода в slovo** — endpoint `/catalog/items/bulk` подразумевает версионирование DTO под каждый sourceSystem. С 1С, manual-импортом масштабироваться будет тяжело.
4. **Двойной handling больших binary** — картинки 305 штук × ~2MB. Push-payload получается мульти-мегабайтным, сетевой round-trip CRM→slovo для каждого товара = слабое место.
5. **Rate-limiting на endpoint'е** — нужно настраивать на стороне slovo, защита от взбесившегося feeder'а. С pull-моделью slovo сам решает когда читать.

## Решение

**Catalog ingest — file-based pull через shared MinIO bucket `slovo-datasets`.**

### Ownership и flow

```
[Feeder owns]                              [Shared infra]                [slovo owns]

CRM resetCacheAndInitializeSettings
  ├─ собирает rich items (services, components)
  ├─ скачивает binary картинок из MoySklad
  ├─ s3.PutObject(<sha256>.jpg)        ──→ MinIO bucket
  ├─ вычисляет per-item contentHash         slovo-datasets/
  └─ s3.PutObject(latest.json)         ──→   catalogs/aquaphor/
                                              ├─ latest.json
                                              ├─ history/<ts>.json
                                              ├─ images/<id>/<sha>.jpg
                                              └─ group-images/<bid>/<sha>.jpg

                                                      ↑
                                                      │
                                            slovo cron (каждые 4ч)
                                              ├─ s3.HeadObject(latest.json)
                                              │   metadata.contenthash совпал?
                                              │   → skip (0 LLM)
                                              ├─ s3.GetObject(latest.json)
                                              ├─ forEach item:
                                              │   item.contentHash == stored? → skip
                                              │   else → vision_cache lookup,
                                              │           re-embed через Flowise
                                              └─ syncMode=full → soft-delete
                                                  по absence-from-snapshot
```

### Bucket layout

```
slovo-datasets/                                  ← shared bucket
└── catalogs/
    └── <feeder>/                                ← namespace per feeder
        ├── latest.json                          ← текущий snapshot (slovo читает)
        ├── history/
        │   └── 2026-04-27T13-34-01-568Z.json    ← audit + rollback
        ├── images/
        │   └── <productId>/
        │       └── <sha256>.<ext>               ← binary картинок, content-hash в имени
        └── group-images/
            └── <bundleId>/
                └── <sha256>.<ext>               ← картинки группы из Bundle
```

### IAM-разделение

- **Feeder** имеет write-key к `catalogs/<own-feeder>/*` (ничего больше)
- **slovo** имеет read-key ко всему `catalogs/*` префиксу (читает любой feeder)
- Креды лежат в env обеих сторон (`SLOVO_S3_*` для feeder'а, аналогичные для slovo)

### S3 Object metadata в `latest.json`

Feeder при `PutObject` кладёт в `Metadata`:

- `contenthash`: sha256 всего payload — slovo может HEAD без GET, и при совпадении skip всю итерацию
- `syncedat`: дублирует поле в payload
- `itemscount`: сколько items
- `sourcesystem`: `moysklad` / `1c` / etc.

Это даёт **двухуровневую быструю проверку дельты**: HEAD + per-item contentHash.

### Версии и атомарность

- В bucket'е включён **S3 Object Versioning** — `latest.json` имеет историю перезаписей.
- slovo при `GetObject(latest.json)` читает текущую версию атомарно (S3 гарантирует read-consistency).
- TOCTOU между HEAD и GET решается через `If-Match: <etag>` на GET — если между HEAD и GET feeder перезаписал файл, GET вернёт 412 Precondition Failed → slovo ретрит итерацию с новым etag.

## Альтернативы

### A. HTTP push (исходный план)

```
crm → POST /catalog/items/bulk → slovo
```

**Плюсы:**
- Real-time invalidation (slovo получает изменения сразу).
- Нет лишнего сервиса (MinIO).
- Стандартный REST-паттерн.

**Минусы:**
- Coupling по availability (см. контекст).
- Нет аудита.
- Большие payload'ы по сети для binary.
- Версионирование DTO под каждый feeder.

**Отклонена:** real-time не нужен для каталога (товары добавляются раз в неделю, цены — ежедневно, embedding и так пересчитывается с задержкой). Cost устранения coupling и upgrade-friction перевешивают.

### B. RabbitMQ message с ссылками на binary

```
crm → RMQ exchange catalog.sync → slovo consumer
        message: { latestJsonUrl, items: [...lite...] }
```

**Плюсы:**
- Async, decoupled.
- Re-delivery при падении consumer'а.
- Уже есть RMQ в инфре (ADR-003).

**Минусы:**
- Усложняет feeder — теперь ему нужен AMQP-клиент.
- Snapshot всё равно идёт через S3 (binary картинок), а text-payload через RMQ — два контракта вместо одного.
- Нет естественной истории — RMQ не для долгосрочного хранения.

**Отклонена:** дублирует ответственность S3 без явной пользы. RMQ остаётся для **внутренних** worker-задач slovo (vision/embed) — см. ADR-003.

### C. Database-mediated sync (общая Postgres-таблица)

```
crm → INSERT INTO catalog_inbox → slovo cron SELECT/DELETE
```

**Плюсы:**
- Транзакционность.

**Минусы:**
- Нарушает modular-monolith границы (ADR-001) — два сервиса трогают одну БД.
- Невозможно с split-arch (152-ФЗ): CRM в РФ, slovo в EU — отдельные БД.
- Binary картинок всё равно нужно куда-то класть (BLOB в Postgres — антипаттерн).

**Отклонена:** ломает изоляцию сервисов и не работает с будущим split-deployment.

## Последствия

### Положительные

- **Decoupling.** slovo и feeder независимы по availability — каждый сервис может быть down/upgraded без срыва другого.
- **Аудит и rollback.** `history/` хранит все версии snapshot'а с timestamp в имени. Откат = заменить `latest.json` на исторический.
- **Multi-feeder без кода в slovo.** 1С, manual-импорт = ещё один префикс `catalogs/<feeder>/` в bucket'е, slovo читает по тому же контракту. Discriminator `sourceSystem` в payload.
- **152-ФЗ-ready.** Когда дойдём до split-arch (slovo в EU), bucket остаётся в РФ-зоне (или зеркалится). Контракт не меняется.
- **Естественный rate-limit.** Feeder пишет когда нужно, slovo читает по расписанию — нет thundering herd на endpoint'е.
- **EXIF strip / PII filter — на стороне feeder'а.** До MinIO. Каталог в bucket'е уже sanitized, slovo не парится про compliance binary.

### Отрицательные

- **MinIO в инфре slovo обязателен** — добавляется зависимость на S3-совместимое хранилище (но оно уже есть в knowledge-base, ADR-006).
- **Latency invalidation.** При cron каждые 4ч изменение в каталоге доходит до search не моментально. Для каталога это ОК (цены обновляются с лагом, новые товары не критичны real-time). Если потребуется быстрее — cron можно сделать каждые 15 минут (не дороже благодаря HEAD+contenthash skip), либо триггерить `/catalog/sync-now` endpoint вручную.
- **Усложнённая отладка** — два места хранения логики (feeder build + slovo consume). Mitigated через подробные логи `[CatalogSync]` с обеих сторон + history-копии для voirir что именно feeder положил.
- **Cron-инфра в slovo** — нужен либо `@nestjs/schedule` (новая зависимость), либо `apps/worker` с RMQ-делегацией (per ADR-001/003 реалистичнее для long-running ingest, см. план в `vision-catalog-search.md` PR6).

### Нейтральные

- **Versioning bucket'а** — нужно явно включить (`mc anonymous version`, либо в `infra:up` скрипте). Иначе history даёт audit, но atomicity между HEAD и GET — нет.
- **VisionCache (slovo Prisma модель)** — переиспользование описаний картинок keyed по sha256 binary, который и так в имени S3-файла. Cache живёт **глобально**, переиспользуется между cron-синками. Без TTL по умолчанию (см. open question ниже).

## Open questions

1. **VisionCache GC.** За год накопится 10-100k записей при ребрендах/удалениях товаров. Нужен ли cron-vacuum по `lastUsedAt`, или достаточно «никогда не чистим» (cache небольшой, JSON-описания по 200-500 байт)? Решить после первого года в проде.
2. **Bucket per environment.** В prod хочется отдельный bucket `slovo-datasets-prod`, `slovo-datasets-staging`. На каком уровне разделять — bucket name или путь префиксом? Path-style проще для MinIO, разные bucket'ы — для managed S3. Решить когда дойдём до prod-deploy.
3. **Multi-tenant readiness.** Когда появятся пользователи, каталог станет per-tenant (`catalogs/<tenant>/<feeder>/`). Контракт совместим — расширяется добавлением одного уровня в путь. ADR не пересматривается.

## Связанные ADR

- **ADR-001** (Modular Monolith) — feeder и slovo остаются независимыми сервисами с чётко определённой границей через S3 контракт.
- **ADR-003** (RabbitMQ) — RMQ остаётся для async-задач **внутри** slovo (vision/embed worker), не для inter-service коммуникации.
- **ADR-006** (Knowledge Base) — тот же ownership-split паттерн (`Prisma metadata + Flowise embeddings`) применяется к VisionCache.
- **Будущий ADR-008** (split-deployment 152-ФЗ) — этот ADR совместим со split-arch без пересмотра контракта.

## Когда пересмотреть

- Если cron-latency 4ч начнёт мешать UX (менеджер изменил цену, ждёт 4ч пока в search обновится) → перейти на webhook-trigger от feeder'а (`POST /catalog/sync-now`) **поверх** того же файлового контракта (slovo читает по триггеру + по cron). ADR не отменяется.
- Если каталог вырастет на порядок (>10K товаров) и MinIO RPS станет узким местом → пересмотреть выбор хранилища (managed S3, Cloudflare R2). Контракт остаётся.
- Если появится требование **bidirectional sync** (slovo пишет обратно в CRM что именно нашлось при поиске → feeder использует для аналитики) → добавить второй префикс `catalogs/<feeder>/feedback/` без изменения основного flow.
