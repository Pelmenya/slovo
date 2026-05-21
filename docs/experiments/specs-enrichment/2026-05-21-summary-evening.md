# Step 6.5 evening session — summary

> **Дата**: 2026-05-21 (вечер)
> **Время**: ~6 часов R&D
> **Бюджет**: $5.5 (~520 ₽) — Anthropic + OpenAI

## Хронология

1. **Smoke 20Q reference** — 92.5% Haiku tuned + Q9 fix
2. **Smoke 30Q real-world (v2)** — accuracy дропнул до **50-52%**
3. **Auto-grader через Flowise judge** (Sonnet 4.6) — automated finding wrong claims
4. **Iter2 prompt tuning** (rules 23-27) — minor improvement (+2pp)
5. **KNOWN_FACTS audit** — обнаружил **свои** ошибки в ground truth
6. **Re-judge corrected** — real high-sev wrong meньше на 5 per setup (false positives detected)
7. **DS merge PoC** — built merged gold chunks для 13 моделей, **conflict resolution** policy

## Финальные cifры

| Setup | v1 reference | v2 real-world (iter1) | v2 real-world (iter2 corrected) |
|-------|-------------:|----------------------:|--------------------------------:|
| Haiku agentflow | **92.5%** | **50%** | **52%** |
| GPT-4o-mini agentflow | 80% | 48% | 50% |

**Truth**: cherry-picked reference set даёт illusion of 90%+ accuracy. На **real-world** queries реальная accuracy **50-55%**.

## Что обнаружено

### 1. False ground truth bug
Мой KNOWN_FACTS hardcoded неверные «facts»:
- ❌ «DWM-202S Pro не существует» — на самом деле **специфический pasport PDF существует** в специфической DS
- ❌ «WS500 single price 74 990 ₽» — есть K/0.35 за 94 980
- ❌ «DWM-101S base 22 980 ₽» — реально **16 900 ₽** (bundle math AI был прав)
- ❌ Пропустил WS1000, DWM-202S-C-LD

### 2. Inter-source conflicts (catalog ERP vs PDF specs)
**Specs PDF self-contradicts**:
- В разделе «Назначение» DWM-102S Pro — модули «К7М»
- В разделе «Расходники» — «Pro BMg»

**ERP** говорит **Pro BMg** (current). Specs PDF возможно outdated pasport.

**Conflict resolution policy** для merge:
- ERP = primary truth для current modules / prices
- Specs = secondary для tech depth
- Anti-confusion footer at chunk-level

### 3. Pattern bugs остались (real, не false positive)
- **Pro H за 1 450 ₽** — fabrication
- **LED Err1/Err2 у DWM-102S Pro** — fabrication
- **Соль 300 кг/год** — math fabrication
- **WS500 как обезжелезиватель** — knowledge gap (rule 25 fix частично сработал)

## Tier-based architecture forward

```
ERP (МойСклад) ──┐
                  ├── catalog-merge worker ──► catalog-aquaphor-gold DS ──► AI consultant
Specs PDF       ──┘                              ↑
                                                  └── conflict resolution + anti-confusion footers
```

## ADR кандидат — DS merge

**Decision needed**:
1. Создать `catalog-merge worker` в `apps/worker/src/modules/catalog-merge/`?
2. Output → MinIO bucket → bulkIngest в new gold DS
3. Existing 2 DS (ERP, specs) — оставить или deprecate?
4. Frequency: daily cron (same as catalog-refresh)

**Effort**: 5-7 дней для production-ready (worker + tests + DS upsert MCP + chatflow migration).

## Budget today

- Anthropic: **$4.62** (~440 ₽)
- OpenAI: **$0.07** (~7 ₽)
- **Total**: $4.69 ≈ 447 ₽

Бюджет аккаунтов: Anthropic осталось ~$4.4, OpenAI ~$8.93.

## Open items для следующей сессии

1. **DS merge** — write ADR + plan worker
2. **Tool-grounded verification** — POST /catalog/verify endpoint design
3. **Real-world test set expansion** — 50+ queries что AI должен handle
4. **Production accuracy threshold** — 60%? 70%? Где floor для launch?
5. **Анти-fabrication strategy** — какой trade-off precision vs recall?
