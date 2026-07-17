# Session Handoff

> Обновляется целиком перед завершением сессии, максимум 50 строк. Только техсостояние.
> Чувствительный контекст — в приватной памяти, НЕ здесь. Два трека: agentic-core и voice.

**Дата**: 2026-07-17

## 🎙️ VOICE (агент slovo-voice, активен 2026-07-17)

**Голосовой робот для клиник переехал из medods-voice — ПОРТ ЗАВЕРШЁН, весь контур проверен
на реальном `.env`.** medods-voice теперь архив.

Сделано (коммиты 10ddaa0, 6a3b8a2, 1e6fd4e, 33fb931):

- `prisma/schema/voice.prisma` — Clinic (тенант: голос, шаблоны фраз, env-неймспейс), Call,
  CallTurn. Миграция применена через Flowise-drift workaround (diff → только voice_*).
- `libs/voice` — telephony (ARI), speech (TTS/STT), dialog (state machine + классификатор
  AI Studio). 82 теста. Конвенции slovo: type+T, lowercase-энумы, энумы из @prisma/client.
- `apps/voice` — CLI (synth/recognize/classify), свой voice-env-контур (не slovo validateEnv).
- `docker-compose.voice.yml` — Asterisk отдельным стеком (npm run voice:up), общий slovo-postgres.
- ✅ Проверено вживую из `.env`: SIP-транк Novofon **Registered**, ARI отвечает, TTS→STT
  round-trip, classify keyword=confirm и LLM=reschedule (439 мс). 1523 теста slovo зелёные.

Отложено Димой (НЕ делать без обсуждения): миграция 13 issues из medods-voice; MCP-контракт
вертикали (find_patient/get_appointments/list_free_slots/create_appointment/patch_confirmation/
get_prices; MCP Hub бесплатен). Хвосты: call-цикл (блокирован УКЭП; в slovo нет CQRS),
классификатор → кандидат в libs/llm как первый OpenAI-провайдер (нужна координация с backend).

Решения: slovo сделан приватным (ноу-хау не отдаём). Тенант = данные+конфиг, не логика.
Классификатор в звонке — прямой вызов AI Studio, не Flowise (Flowise для RAG-фич ступени 2).

## 🟡 AGENTIC-CORE (агент slovo-backend, HOLD — не трогать из voice-сессий)

Ждём ADR-012 (opencode-adoption / HYBRID v4). Phase 1 done, B0 spike done → рекомендация
HYBRID v4. Следующий шаг: решить ADR-012 (adopt vs build) ИЛИ спайк фабрики.
Docs: `docs/features/agentic-core.md` + ADR-011 (ждут ADR-012 amendment).

## Git-заметка (общая)

- `main` под branch protection: прямой push только у owner (admin bypass); остальным — PR + аппрув.
- Не force-пушить опубликованные чужие коммиты (даёт дубль-merge при их pull).
- voice-регистрация в nest-cli/tsconfig/jest/package аддитивна — существующее не трогалось.
