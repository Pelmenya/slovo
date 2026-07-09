# Session Handoff

> Обновляется автоматически перед завершением сессии. Перезаписывается целиком, максимум 50 строк.

**Дата**: 2026-06-27

## Текущая задача

🟡 **HOLD — ждём REVIEWER+VERIFIER → ADR-012 (opencode-adoption).**

Phase 1 done. B0 spike done → рекомендация HYBRID v4 (test-backed, 5 live runs).
Phase 2/3 — НЕ строим. Phase 5+ — после ADR-012.

## State (что сделано)

- ✅ A1–A7 verified (REVIEWER по факту в файлах, VERIFIER апрувил)
- ✅ Phase 1: `prisma/schema/agentic.prisma` (6 моделей) + миграция `20260620155400` applied + seed ModelHealth (3 строки) + generated DTOs
- ✅ B0 спайк: OpenCode v1.17.9, 5 live test runs, рекомендация HYBRID v4 test-backed
- ✅ Evidence-first правило записано в CLAUDE.md (против conclusion-anchoring)
- ✅ **OpenRouter гео-блок**: tinyproxy (EU VPS `127.0.0.1:10810`) обходит, API работает
- ✅ **OpenRouter Broadcast → Langfuse**: настроен и верифицирован (2026-06-27)
  - I/O Logging включён, Broadcast включён, destination ID `10116`, 100% sampling
  - Langfuse: `https://nastily-gratifying-soldierfish.cloudpub.ru`, project `slovo-dev`
  - Ключ `openrouter-broadcast` (`pk-lf-e0e18a50-f3fc-415b-a12d-c09885e267c9`)
  - Тестовый trace дошёл (gpt-4-turbo, 1.3s, $0.02) ✅

## HYBRID v4 — adopt vs build

**Adopt из OpenCode:** loop / MCP bridge / multi-provider / A3 permission gate / session persistence / prompt caching / cost tracking

**Build (governance-слой):** A5 dedup-by-event · A6 error classifier · A7 SSE proxy · budget watchdog · Langfuse hook · RunEvent log (Phase 1 schema готова)

**Отменяется:** Phase 2 (LLM adapters) + Phase 3 (loop core)
**Переформулируется:** Phase 4 (worker через `opencode serve`)
**Остаётся:** Phase 5+ (SSE proxy, dedup, A/B eval)

## Ожидание

1. REVIEWER: независимая сверка load-bearing v4-claims
2. VERIFIER: апрув HYBRID + ответы на 5 open Q (lab journal § Open questions)
3. ADR-012 (opencode-adoption) — ТОЛЬКО из test-backed findings v4

## Cleanup (после VERIFIER go)

3 spike DS: `f46f02ba-...` / `885ecadb-...` / `0b878707-...`
4 sessions: `ses_111e17640...` / `ses_111e28836...` / `ses_111e32069...` / `ses_111e38f16...`
Config throwaway: `experiments/opencode-spike/opencode.json`

## Связанные docs

- `experiments/agentic-core/opencode-spike-2026-06-22.md` — lab journal B0 (§ Errata — история 4 версий)
- `docs/features/agentic-core.md` + ADR-011 — не тронуты (ждут ADR-012 amendment)
- memory `project_openrouter_langfuse_broadcast` — полная конфигурация Broadcast
