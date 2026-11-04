# Session Handoff

> Обновляется целиком перед завершением сессии, максимум 50 строк. Только техсостояние.
> Чувствительный контекст — в приватной памяти, НЕ здесь.

**Дата**: 2026-11-04

## 🎬 DEMO-VIDEO repo-vitals — собрано 20.10 (v2 + правки fixes-v2)

Вне slovo: рабочая папка `repovitals-demo` на рабочем столе. Там задания (`tasks/`: v1, v2,
fixes-v2, fixes-v3), скрипты и `RUNBOOK.md` — как перезаписать. Итог: `demo.mp4` 5:36 +
`demo.srt`, 14 кадров. Голос v3 `alexander`/`good`/1.0, ключ SpeechKit — `YANDEX_API_KEY`
в slovo `.env`, синтез запуска
...[575 chars omitted]...
ние: НЕ выносить до второго потребителя. Для slovo: ADR-012 «adopt vs build»
→ вопрос «переносить ли Ralph».

## 🎙️ VOICE (порт завершён 2026-07-17)

`libs/voice` + `apps/voice` + `docker-compose.voice.yml`, 1523 теста зелёные. Отложено без
обсуждения не трогать: 13 issues medods-voice, MCP-контракт вертикали, call-цикл (УКЭП).
TTS в `libs/voice` жёстко 8 кГц (телефония) — для других задач свой синтез.

## Git-заметка

- `main` под branch protection: прямой push только у owner.
- `media/` и `craftteam-deck-*` в `.gitignore` — бинарники демо и презентаций, исходники на Диске.
