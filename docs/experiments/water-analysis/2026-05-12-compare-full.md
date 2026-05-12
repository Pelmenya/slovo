# Docling vs Vision — full compare report

**Date:** 2026-05-12T13:38:04.014Z
**Dataset:** 15504 common orders (Docling: 15504, Vision: 15504)

---

## A) Extraction-level (Docling parsed vs Vision raw `vision_payload`)

Apples-to-apples — что Docling extracted vs что Vision extracted, до slovo нормализации.

| Field | agree | disagree | onlyDocling | onlyVision | bothNull |
|---|---|---|---|---|---|
| customerName (vs pii.jsonl) | 12170 (78.6%) | 3071 (19.8%) | 5 (0.0%) | 244 (1.6%) | 0 (0.0%) |
| objectAddress | 9442 (61.0%) | 3552 (22.9%) | 1 (0.0%) | 1075 (6.9%) | 1420 (9.2%) |
| depthMeters | 7696 (49.7%) | 0 (0.0%) | 484 (3.1%) | 935 (6.0%) | 6375 (41.2%) |
| sampleDate | 15080 (97.4%) | 81 (0.5%) | 0 (0.0%) | 329 (2.1%) | 0 (0.0%) |
| testDate | 14996 (96.8%) | 225 (1.5%) | 0 (0.0%) | 269 (1.7%) | 0 (0.0%) |
| intakeType (mapped→enum) | 11370 (73.4%) | 4107 (26.5%) | 13 (0.1%) | 0 (0.0%) | 0 (0.0%) |

## B) End-to-end (Docling+deriveIntakeType vs water_analysis derived canonical)

Что получит downstream (heatmap, predict, equipment-suggest), если перейдём на Docling. Docling прогон через те же эвристики, Vision уже через slovo 05-normalize.ts.

| Field | agree | disagree | onlyDocling | onlyVision | bothNull |
|---|---|---|---|---|---|
| intakeType (enum) | 10051 (64.9%) | 5439 (35.1%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) |
| depthMeters | 7696 (49.7%) | 0 (0.0%) | 484 (3.1%) | 931 (6.0%) | 6379 (41.2%) |
| sampleDate | 15080 (97.4%) | 81 (0.5%) | 0 (0.0%) | 329 (2.1%) | 0 (0.0%) |
| testDate | 14996 (96.8%) | 225 (1.5%) | 0 (0.0%) | 269 (1.7%) | 0 (0.0%) |

### intakeType confusion matrix (Vision derived vs Docling derived)

Строки = Vision (ground truth), столбцы = Docling (predicted)

| Vision \\ Docling | well | well_dug | municipal | spring | river | other | null | row total |
|---|---|---|---|---|---|---|---|---|
| **well** | 5714 | 1314 | 3241 | 0 | 0 | 0 | 8 | 10277 |
| **well_dug** | 5 | 1051 | 741 | 0 | 0 | 0 | 3 | 1800 |
| **municipal** | 14 | 81 | 3286 | 0 | 0 | 0 | 3 | 3384 |
| **spring** | 0 | 0 | 17 | 0 | 0 | 0 | 0 | 17 |
| **river** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **other** | 0 | 1 | 25 | 0 | 0 | 0 | 0 | 26 |
| **null** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Sample disagreements (для ручной сверки)

### customerName (PII sanitized — паттерны, не реальные данные)

5 типичных Docling vs Vision differences по customerName на разных order numbers (PII удалена; конкретные ФИО доступны только локально в `experiments/water-analysis-dataset/data/pii.jsonl`):

| Pattern | Docling | Vision OCR |
|---|---|---|
| Замена буквы в фамилии | `<ФИО-A>` | `<ФИО-A-misread>` (1 буква отличается) |
| Замена «ж»↔«к» | `<ФИО-B>` | `<ФИО-B-misread>` |
| «щ»↔«ш» | `<ФИО-C>` | `<ФИО-C-misread>` |
| «Т»↔«Г» (заглавная) | `<ФИО-D>` | `<ФИО-D-misread>` |
| Склейка ИП-инициалов | `ИП<имя>` | `ИП <имя>` |

### objectAddress (КРИТИЧНО для геокода — PII sanitized)

5 типичных кейсов phone-склейки в Vision (адрес чистый в Docling). До уровня района — без СНТ/деревни (PII):

| Pattern | Docling (clean) | Vision (phone+address склейка) |
|---|---|---|
| Phone + район-деревня | `<МО-район-A>, д. <деревня-A>` | `<phone> <МО-район-A>, д. <деревня-A>` |
| Phone + СНТ | `<МО-район-B>, СНТ <name>` | `<phone> <МО-район-B>, СНГ <name>` (CHN OCR) |
| Phone + район-точка | `<МО-район-C>, д. <деревня-C>` | `<phone> <МО-район-C>., о. <деревня-C>` (OCR) |
| Phone + обозначение пробы | `<район-D>, СНТ <name> обр. №2(после фильтра)` | `<phone> <район-D>, СНТ <name> обр. №2 (после фильтра)` |

Order numbers и конкретные адреса доступны только в pii.jsonl (gitignored). Эта таблица иллюстрирует **паттерны** OCR-ошибок Vision относительно Docling.

### sampleDate

| Order | Docling | Vision |
|---|---|---|
| 10926 | "2022-03-03" | "2022-03-05" |
| 10927 | "2022-03-03" | "2022-03-05" |
| 10929 | "2022-03-03" | "2022-03-05" |
| 10933 | "2022-03-03" | "2022-03-09" |
| 10934 | "2022-03-03" | "2022-03-09" |

### intakeType (end-to-end)

| Order | Docling | Vision |
|---|---|---|
| 10007 | "municipal" | "well" |
| 10008 | "municipal" | "well" |
| 10013 | "municipal" | "well" |
| 10014 | "municipal" | "well" |
| 10015 | "well_dug" | "well" |
