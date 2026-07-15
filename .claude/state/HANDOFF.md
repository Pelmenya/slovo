# Session Handoff

> Обновляется автоматически перед завершением сессии. Перезаписывается целиком, максимум 50 строк.
> Только техническое состояние. Чувствительный контекст — в приватной памяти, НЕ в этом файле.

**Дата**: 2026-07-15

## Текущая задача

🟡 **agentic-core HOLD** — ждём решения по ADR-012 (opencode-adoption / HYBRID v4).
Phase 1 done. B0 spike done → рекомендация HYBRID v4 (adopt OpenCode loop/MCP/permission,
build governance-слой). Phase 2/3 — НЕ строим.

## Сделано (2026-07-09 → 2026-07-15)

- ✅ `docs/features/agentic-core.md` + ADR-011 закоммичены (были untracked) + north-star секция «agent factory» + пометка «спайк B0 → HYBRID v4»
- ✅ **Репа заблокирована на запись**: write-коллабораторы убраны (только owner `Pelmenya`),
  branch protection на `main` — require PR + 1 approving review, `enforce_admins: false`
  (owner пушит/force-пушит напрямую), любой будущий коллаборатор под PR-гейтом
- ✅ История `main` линейная/чистая (`130b5ef`) — убраны дубли + merge-коммит после lockdown
- ✅ MEMORY.md актуализирован (доступ, урок про force-push опубликованных коммитов)

## Следующие шаги

1. **agentic-core**: решить ADR-012 (adopt vs build по HYBRID v4) — self-approve v4-claims
   ИЛИ спайк фабрики (один обратимый end-to-end: задача → авто-стек → self-validate)
2. Cleanup спайка (после go): 3 spike DS + 4 sessions + throwaway `experiments/opencode-spike/opencode.json`

## Инфра (готово ранее)

- OpenRouter гео-блок: tinyproxy (EU VPS `127.0.0.1:10810`) обходит
- OpenRouter Broadcast → Langfuse: dest `10116`, 100% sampling, верифицирован
  (детали — память `project_openrouter_langfuse_broadcast`)

## Git-заметка

- `main` под branch protection: прямой push только у owner (admin bypass); остальным — через PR + аппрув.
- Не force-пушить опубликованные чужие коммиты (даёт дубль-merge при их pull).

## Связанные docs

- `experiments/agentic-core/opencode-spike-2026-06-22.md` — lab journal B0
- `docs/features/agentic-core.md` + ADR-011 — feature spec + ADR (ждут ADR-012 amendment)
