# Session Handoff

> Обновляется целиком перед завершением сессии, максимум 50 строк. Только техсостояние.
> Чувствительный контекст — в приватной памяти, НЕ здесь.

**Дата**: 2026-09-26

## 🎬 DEMO-VIDEO repo-vitals — СОБРАНО 26.09

Задание (финал, 8 кадров): `demo-video-agent-task.md` (корень slovo, не закоммичен).
Результат: `~/Desktop/repovitals-demo/demo.mp4` (3:40) + `demo.srt`; `RUNBOOK.md` там же —
как перезаписать. Голос v3 `alexander`/`good`/1.0. Ключ SpeechKit — `YANDEX_API_KEY` в
slovo `.env`, синтез запускает человек (`--env-file`), агенту `.env` закрыт guard-хуком.
Захват — CDP screencast (recordVideo мутный), ожидания вырезаются паузами захвата.
`auth.json` удалён. `medbridge/medods-bridge` уже проанализирован дважды (в кадре 5a).
Ждём отзыв Димы по видео.

## 📄 WORKFLOWS-PITCH — отправлен 29.07, ждём ответ

`docs/proposals/2026-07-29-yandex-workflows-agent-builder.md` (t.me/yandexcloud_chat).
У Яндекса есть `workflows-mcp-server` (create/update/execution_history) — петля самовалидации
замыкается. Спайк наготове (не начат): кейс вебинара через `workflow_create`, метрика —
итерации до зелёного прогона; нужен доступ к YC API.

## 🔁 RALPH (pixel-tanks, вне slovo)

`~/Desktop/pixel-tanks/.claude/ralph` — agent delivery loop, фазы 1-6 закрыты, 3 привязки к
Claude. Решение: НЕ выносить до второго потребителя. Для slovo: ADR-012 «adopt vs build»
→ вопрос «переносить ли Ralph».

## 🎙️ VOICE (порт завершён 2026-07-17)

`libs/voice` + `apps/voice` + `docker-compose.voice.yml`, 1523 теста зелёные. Отложено без
обсуждения не трогать: 13 issues medods-voice, MCP-контракт вертикали, call-цикл (УКЭП).
TTS в `libs/voice` жёстко 8 кГц (телефония) — для других задач свой синтез.

## Git-заметка

- `main` под branch protection: прямой push только у owner.
- Не закоммичены: `docs/proposals/`, `demo-video-agent-task.md`.
