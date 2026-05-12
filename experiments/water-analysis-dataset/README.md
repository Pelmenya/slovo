# water-analysis-dataset — Этап 1.A + 1.B pipeline

Разовый ETL для оцифровки 15 504 бланков анализов воды Аквафор-Pro 2020-2026
(Этап 1.A + 1.A.5 + 1.B + Phase 2 закрыты 2026-05-07). См. полный план
в [`docs/features/water-analysis.md`](../../docs/features/water-analysis.md).

## Что делает

```
.docx/.dotx/.pdf → Gotenberg → .pdf → pdf-img-convert → PNG → Flowise chatflow
                                                                    ↓
filename regex ─────────────────────────────────────────────┐  Vision JSON
                                                             ↓       ↓
                              insert WaterAnalysisRaw ←──────┴───────┘
                                              ↓
                              Ahunter geocode (rawAddress / dealerLocation fallback)
                                              ↓
                              update WaterAnalysisRaw (ahunterRawResponse)
                                              ↓
                              normalize → insert WaterAnalysis
```

PII (ФИО + телефон) — отдельно в `data/pii.jsonl`, gitignored, локально.

## Запуск

### 1. Поднять Gotenberg

```bash
docker compose -f experiments/water-analysis-dataset/docker-compose.yml up -d
# проверить
curl --noproxy '*' http://127.0.0.1:3120/health
```

### 2. Установить локальные deps

```bash
cd experiments/water-analysis-dataset
npm install
```

### 3. Положить бланки

Все `.docx`/`.dotx`/`.pdf` бланки в `data/blanks/`. На Windows можно
сделать симлинк на `~/Desktop/water-analysis-digitizer/blanks/`:

```powershell
New-Item -ItemType SymbolicLink -Path .\data\blanks -Target C:\Users\Diamond\Desktop\water-analysis-digitizer\blanks
```

### 4. Прогнать pipeline по шагам

```bash
# 1.A — extraction
npx tsx scripts/01-convert.ts        # docx/dotx → pdf
npx tsx scripts/02-rasterize.ts      # pdf → png
npx tsx scripts/03-extract.ts        # PNG → Flowise → WaterAnalysisRaw + pii.jsonl
npx tsx scripts/04-geocode.ts        # WaterAnalysisRaw → Ahunter → update record

# 1.B — normalization
npx tsx scripts/05-normalize.ts      # WaterAnalysisRaw → WaterAnalysis (v1.0.0)

# Sanity checks
npx tsx scripts/99-eda.ts            # гистограммы, карта МО, кластеры
```

Все скрипты idempotent: ключ дедупликации — `orderNumber`, при повторном
запуске пропускают уже обработанные.

## Структура

```
.
├── README.md
├── docker-compose.yml          # Gotenberg для docx→pdf
├── package.json                # локальные deps (pdf-img-convert)
├── .gitignore                  # data/, *.png, *.jsonl
├── prompts/
│   └── water-blank-extractor.md     # system prompt для Claude Vision
├── schemas/
│   └── water-blank-extraction-v1.ts # Zod схема output'а Vision
├── scripts/
│   ├── 01-convert.ts
│   ├── 02-rasterize.ts
│   ├── 03-extract.ts
│   ├── 04-geocode.ts
│   ├── 05-normalize.ts
│   └── 99-eda.ts
└── data/                       # gitignored, локально
    ├── blanks/                 # симлинк на water-analysis-digitizer/blanks
    ├── normalized/             # *.pdf после Gotenberg
    ├── pages/                  # *.png страниц
    ├── pii.jsonl               # ФИО+телефон, локально
    └── extraction-logs/        # raw response каждого Vision-вызова
```

## Cost (фактически на 15 504 бланка)

> Источник правды — [`docs/management/water-analysis-executive-summary.md`](../../docs/management/water-analysis-executive-summary.md)
> секция «Стоимость». При обновлении цифр править там и здесь синхронно.

| Стадия | Стоимость | Примечание |
|---|---|---|
| Vision extraction (Haiku 4.5) | **$217.82** (~21 750 ₽) | base $176.25 + VAT 21% $37.01 + conversion 2% $4.27. ~$0.014/бланк (avg ~2.2 страницы PNG + prompt 176 строк). Голый Anthropic $0.0114/бланк сходится: 6 942 input + 884 output tokens × Haiku tariff |
| Ahunter geocoding | ≥ 2 000 ₽ | минус кеш повторных адресов, +AI-verify через Claude |
| Embeddings (Phase 2 закрыт 2026-05-07) | **$0.29** (~29 ₽) | OpenAI `text-embedding-3-large` (3072 dim) через Flowise Custom Document Loader — апгрейд с `-small` ради recall на химии |
| **Итого Этап 1.A + 1.A.5 + 1.B + Phase 2** | **≥ 23 779 ₽** | разово на весь датасет |

**Главный driver overhead'а** — multi-page documents (2.2 страницы avg vs 1 в первоначальной оценке) + 25% накруток (VAT+conversion), не размер промпта. Сам prompt = ~22% input cost. Autocache silent-disabled (Haiku <2048 tokens prefix) — `cache_read=0`. См. [`docs/experiments/water-analysis/2026-05-05-bitrix-archive-merge.md`](../../docs/experiments/water-analysis/2026-05-05-bitrix-archive-merge.md) lines 152-172 для reproducible math.

## Связанные конвенции

- Нейминг ресурсов Flowise — `docs/guides/flowise-naming.md`
- Тип-конвенции slovo (только `type`, префикс `T`, файлы `t-*.ts`) — `CLAUDE.md`
- Drift workaround при Prisma-миграциях — `CLAUDE.md` → «Prisma миграции — forward-only»
