# Этап 1.A — Vision extract: фактические затраты и тайминги

> Lab journal от 2026-05-04. Закрытие Этапа 1.A water-analysis (extract 5430 бланков
> через Claude Vision Haiku 4.5 + Flowise). Источник правды по cost — Anthropic
> Console billing CSV (см. `experiments/water-analysis-dataset/data/.phase-timings.jsonl`
> для script-side estimates).

## Финальный счётчик

| Этап | Вход | Записей | Длительность | Стоимость |
|---|---|---|---|---|
| **01-convert** (Gotenberg) | 5484 docx/dotx/pdf | 5430 PDF | 43m 18s | $0 (локально) |
| **02-rasterize** (mupdf WASM) | 5430 PDF | 5474 PNG (1.0 страниц/файл avg) | 8m 38s | $0 (локально) |
| **03-extract** (Vision Haiku 4.5 через Flowise) | 5430 PNG | 5430 records в `water_analysis_raw` | wall ~5h 30m (sum sequential) | **$62.10** |
| **04-geocode pilot** (Ahunter) | 443 records | 200 matched (45%) | 30s | ~40 ₽ ($0.40) |

**Итого Этап 1.A:** **~$62.50** (Anthropic) **+ 40 ₽** (Ahunter)

## Детализация extract по фазам

| Фаза | Records | Sequential / Parallel | Длительность | Cost (estimated) |
|---|---|---|---|---|
| Pilot + Stress 200 (rerun) | 200 | sequential | ~30 минут | ~$2 |
| Batch 1 (sequential) | 1000 | 1 шард | 2h 28m 20s | $11.50 |
| 4-shard pilot 100/each | 400 | 4 параллельно | 13m 41s wall | $4.60 |
| 4-shard full | 3830 | 4 параллельно | **2h 24m wall** | $44.04 |

Sequential проходило ~7-8 RPM. 4-shard parallel дал устойчивые **~30 RPM**, ускорение **~4×**.

## Реальный billing Anthropic (CSV)

```
2026-05-04, claude-haiku-4-5-20251001:
  input_tokens_no_cache:  38,021,296
  cache_write/read:                0   (silent-disable < 2048 tokens threshold)
  output_tokens:           4,815,981
  cost = 38.02M × $1/M + 4.82M × $5/M = $38.02 + $24.08 = $62.10
```

**Cache rate 0%** — известная фишка для Haiku 4.5 + русский system prompt < 2048 tokens
(см. memory `feedback_autocache_haiku_russian_threshold`). Если расширить prompt до
2500+ tokens — кеш заработает (cache_read $0.10/M, в 10× дешевле). Не оптимизировали
сейчас — на повторных прогонах Этап 1.A не понадобится.

**Avg cost per call:** $62.10 / 5230 calls ≈ **$0.0119/call** (ровно как estimated $0.0115).

## Throughput / rate limits на Tier 2

| Limit | Используемый peak | Запас |
|---|---|---|
| Haiku 4.5 RPM | ~30 (4 шарда × 7-8 RPM) из 1000 | 33× |
| **Input tokens/min** | ~80% peak (~360K из 450K) | **bottleneck** |
| Output tokens/min | ~80% peak (~70K из 90K) | близко |

**Sweet spot — 4 шарда.** На 8 шардов упрёмся в input tokens/min limit, начнут сыпаться 429.

## Operational lessons learned

1. **Gotenberg LibreOffice degradation** — после ~1000 conversions soffice копит память,
   супервизор уходит в 30s timeout → 503. Лечится `--libreoffice-restart-after=10` +
   `--libreoffice-max-queue-size=100` + `--api-timeout=120s`. Прецедент в convert phase.
2. **Retry в convert (5 attempts exp backoff)** спасло от потери файлов при Gotenberg
   recreate. Только 2 файла (8574, 8575) пропали и были вручную добиты.
3. **Sharding modulo (a не slice)** — даёт псевдо-случайное распределение, load-balanced
   между шардами, без race condition на одних orderNumbers.
4. **Idempotency через sourceFileHash + DB skip** — позволяет резервно перезапускать
   любой шард, рестартить процесс, ничего не дублируется.
5. **Flowise prediction queue** — выдержал 4 параллельных потока без drop-ов. Anthropic
   peak hours (US morning) добавляет 2-3× latency, но не cost.

## Что в DB

```sql
SELECT COUNT(*) FROM water_analysis_raw;       -- 5430
SELECT COUNT(*) FROM water_analysis_raw
WHERE vision_payload->>'objectAddress' IS NOT NULL
  AND LENGTH(vision_payload->>'objectAddress') > 2;  -- 4287 (79%)

-- 100% покрытие: sampleDate, testDate, intakeType, params (15+ measurement/record)
-- 79% objectAddress (потенциальные точки на карте)
-- 0% PII санитизации в raw — 152-ФЗ обезличивание при derive в Этап 1.B (см. task #35)
```

## Бюджет / кредиты Anthropic

- Стартовый баланс на 2026-05-04: ~$80 (точно неизвестно, видели $79 балaнс баланс / $69.36 после первых трат)
- Спот на конец дня: **~$17-18 credits**
- На завтра (LLM address parser, 5230 calls × $0.0008) хватит с буфером ~$13.

## Дальше — Этап 1.A → 1.B handoff

- ✅ raw layer стабилен, append-only, 5430 records
- 🔜 LLM address parsing (Tasks #31-#34): подготовка к full geocode
- 🔜 Manual override для дилеров без геоинфы (Task #36)
- 🔜 Этап 1.B: дерайв в `water_analysis` с обезличиванием PII (Task #35),
  нормализация params, dealer dedup, intakeType → enum
