# CLAUDE.md — apps/voice (голосовой робот для клиник)

Голосовой слой платформы slovo: исходящие звонки-напоминания клиникам на МИС (первая — MEDODS),
подтверждение/перенос/отмена голосом с записью статуса обратно в МИС. Порт из спайка medods-voice.
Стадия: перенесён и проверен на реальном `.env` (транк регистрируется, TTS/STT/classify зелёные);
дальше — живые звонки (ждут УКЭП) и MCP-контракт вертикали.

## Где что

- `apps/voice/` — CLI (nest-commander): `synth`, `recognize`, `classify`. Свой voice-env-контур
  (`voice-env.schema.ts`), НЕ slovo `validateEnv`.
- `libs/voice/` — telephony (Asterisk/ARI), speech (SpeechKit TTS/STT), dialog (рукописная
  state machine + классификатор Yandex AI Studio; keyword fast-path до LLM).
- `prisma/schema/voice.prisma` — `Clinic` (тенант: голос, шаблоны фраз, env-неймспейс), `Call`, `CallTurn`.
- `docker-compose.voice.yml` — Asterisk отдельным стеком (`npm run voice:up`), общий slovo-postgres.

## Методология разработки (маленькими шагами, без пожирания контекста)

Инструменты перенесены из спайка (`.claude/skills/`, `.claude/ralph/`). Воркфлоу фичи:

1. `/prd {фича}` → `docs/features/{feature}/prd.md`
2. `/plan-phase {prd}` → план с независимыми фазами
3. `/research {план}` → технические решения приняты заранее (не выбирать библиотеки в реализации)
4. `/issues {план}` → **GitHub milestones + issues на Pelmenya/slovo** (лейбл `voice`)
5. Реализация: вручную по issues ИЛИ автономно — Ralph loop (`.claude/ralph/`, одна сессия =
   один issue, TDD, circuit breaker на 5 попыток). Ralph работает в feature-ветке; PR — человек
   (в slovo `main` под branch protection: PR + аппрув).
6. Перед PR: ревью-агенты slovo (`nestjs-code-reviewer`, `prisma-pgvector-reviewer`,
   `llm-integration-reviewer`, `security-auditor`).

**Доски две, о разном:** GitHub-issues = что делать по voice (Ralph берёт отсюда);
`~/.claude/AGENT-STATUS.md` = кросс-агентная координация (кто что трогает, если параллелят).

## Команды

- `npm run voice:up` / `voice:down` / `voice:logs` — Asterisk-стек
- `npm run voice:synth -- --text "..." --out имя` — синтез TTS в media/sounds
- `npm run voice:recognize -- файл.wav` — STT
- `npm run voice:classify -- "реплика"` — классификация интента (проба мозга)
- Тесты войса: `npx jest libs/voice apps/voice`; линт: `npx eslint libs/voice apps/voice`

## Конвенции

- Никаких реальных данных пациентов в git (152-ФЗ/323-ФЗ). Секреты — в `.env` (gitignored,
  защищён guard-хуком). Весь LLM/речь-контур — РФ-юрисдикция (Yandex AI Studio), Anthropic исключён.
- Тенант = данные + конфиг (голос, фразы, транк), НЕ логика. Новая клиника = строка в `Clinic`.
- Классификатор в звонке — прямой вызов AI Studio (латентность), НЕ Flowise. Flowise — для
  RAG-фич ступени 2 (прайс/услуги клиники).
- Решения спайка: `docs/features/` (порт) + medods-voice/docs/voice-reminder-spike/research.md (архив).
