# Session Handoff

> Обновляется автоматически перед закрытием сессии. Перезаписывается целиком, максимум 50 строк.

**Дата**: 2026-06-03 (initial setup)

## Текущая задача

**RAG bottleneck resolution** для AI-консультанта Аквафор-Pro (slovo specs-enrichment).

ADR-010 (hybrid indexing / gold DS) retired 21 мая — Phase 0 v2 показал -3.1pp accuracy (53.1% vs 56.3% baseline). Root cause: multi-SKU queries падают на single-DS retrieve.

## Последние принятые решения

- **ADR-010 retired** — gold DS merge гипотеза опровергнута (см. `docs/experiments/specs-enrichment/2026-05-21-phase-0-v2-result.md`)
- **Real bottleneck = retrieval recall** на multi-SKU queries (list / compare / recommend), не intra-source conflicts
- **MS GraphRAG = next direction** — production-ready, автоматически merge ERP + PDF через entity extraction
- **Path A первым** — K=6 retrieve bump на existing 2-DS (cheap data point, $0.02, 20 минут)
- **Hooks для persistence** — настроены SessionStart (load-context) + PreCompact (backup-transcript)

## Следующие шаги

1. **Path A test** (warm-up, 20 минут, $0.02) — bump K с 3 → 6 в DocumentStoreVS, re-smoke 4 multi-SKU queries (S19 mixers / G2 WS-compare)
2. **MS GraphRAG PoC** (main task, 4-5 часов, ~$5) — install локально, ingest 13 SKU из `experiments/specs-enrichment/poc-ds-merge/merged-chunks.json`, run same smoke queries
3. **Compare table** — Path A vs GraphRAG vs baseline (56.3%) vs gold DS retired (53.1%)
4. **Decision**: если GraphRAG +5pp → migrate, если <5pp → Path A as final, GraphRAG для future scaling

## Open questions

- Anthropic balance для GraphRAG entity extraction (~$15-17 remaining, $5 PoC fits)
- Hybrid (graph + vector) при +2-5pp GraphRAG — worth complexity или нет?
- Phase 2 AL extension для ML Cup C (отдельный проект, на паузе)

## Связанные docs

- `docs/experiments/specs-enrichment/2026-05-21-phase-0-v2-result.md` — почему gold DS retired
- `docs/features/llm-batch-data-preprocess.md` — pattern guide (writeup ML Cup C work)
- `docs/handoff/2026-05-29-ml-cup-c-batch.md` — последний handoff (ML preprocessing)
