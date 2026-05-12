# Params consistency report — Docling vs Vision

**Date:** 2026-05-12T13:51:19.711Z
**Blanks compared:** 15490  (skipped 14 zero-table)
**Synonyms size:** 80

---

## Per-paramCode consistency

| paramCode | agree | disagree | onlyVision | onlyDocling | agree% |
|---|---:|---:|---:|---:|---:|
| ph | 15237 | 5 | 248 | 0 | 98.4% |
| color | 15236 | 6 | 248 | 0 | 98.4% |
| turbidity | 15448 | 24 | 18 | 0 | 99.7% |
| tds | 15457 | 14 | 19 | 0 | 99.8% |
| manganese | 15426 | 46 | 17 | 0 | 99.6% |
| iron_total | 15390 | 65 | 17 | 17 | 99.4% |
| odor | 13803 | 1667 | 18 | 0 | 89.1% |
| hardness_total | 14357 | 29 | 17 | 1085 | 92.7% |
| sulfides | 13502 | 61 | 15 | 1909 | 87.2% |
| hydrogen_sulfide | 15401 | 32 | 16 | 38 | 99.4% |
| permanganate_oxidizability | 15149 | 21 | 14 | 300 | 97.8% |
| nitrates | 15313 | 29 | 14 | 35 | 99.5% |
| temperature | 15183 | 4 | 8 | 0 | 99.9% |
| fluorides | 14092 | 6 | 59 | 2 | 99.5% |
| magnesium | 4297 | 7 | 434 | 9065 | 31.1% |
| electrical_conductivity | 9554 | 1 | 580 | 0 | 94.3% |
| sulfates | 0 | 0 | 1864 | 0 | 0.0% |
| alkalinity_total | 0 | 0 | 472 | 0 | 0.0% |
| calcium | 46 | 0 | 2 | 0 | 95.8% |
| iron_2plus | 0 | 0 | 47 | 0 | 0.0% |
| nitrites | 0 | 0 | 35 | 0 | 0.0% |
| chlorides | 0 | 0 | 1 | 0 | 0.0% |

## Aggregate across all paramCodes

- **Agree:**     222891  (92.3%)
- **Disagree:**  2017  (0.8%) ← Vision-галлюцинации кандидаты
- **onlyVision:** 4163  (1.7%) ← Vision видел handwritten, Docling нет
- **onlyDocling:** 12451  (5.2%) ← Docling нашёл, Vision пропустил
- **Total instances:** 241522

## Sample disagreements (per paramCode, до 5 примеров)

### ph  (5 total disagreements)

| Order | Vision | Docling |
|---|---|---|
| 10555 | `5,2` | `5,9` |
| 10640 | `8,2` | `8,9` |
| 10966 | `8,2` | `8,9` |
| 12634 | `6,2-8,5` | `7,0` |
| 8398 | `В пределах 6-9` | `-` |

### color  (6 total disagreements)

| Order | Vision | Docling |
|---|---|---|
| 12634 | `20` | `40,3` |
| 12636 | `19,2` | `19,7` |
| 8398 | `20` | `-` |
| 9396 | `76,9` | `20` |
| 9398 | `14,6` | `14,6 20` |

### turbidity  (24 total disagreements)

| Order | Vision | Docling |
|---|---|---|
| 10976 | `2,6` | `0,1` |
| 11100 | `2,6` | `0,2` |
| 11545 | `2,6` | `0,1` |
| 11685 | `2,6` | `0,3` |
| 11687 | `2,6` | `0,3` |

### tds  (14 total disagreements)

| Order | Vision | Docling |
|---|---|---|
| 10268 | `232` | `939` |
| 10287 | `208` | `908` |
| 10303 | `202` | `909` |
| 12407 | `252` | `952` |
| 12634 | `не норм.` | `299` |

### manganese  (46 total disagreements)

| Order | Vision | Docling |
|---|---|---|
| 10023 | `0,0Z` | `0,07` |
| 10072 | `0,0Z` | `0,07` |
| 10416 | `20` | `1,67` |
| 10427 | `55` | `1,34` |
| 10461 | `90` | `2,97` |

### iron_total  (65 total disagreements)

| Order | Vision | Docling |
|---|---|---|
| 10626 | `0,2Z` | `0,27` |
| 10640 | `0,2Z` | `0,27` |
| 10940 | `-` | `1,96` |
| 11365 | `0,22` | `0,29` |
| 11549 | `0,22` | `0,29` |

### odor  (1667 total disagreements)

| Order | Vision | Docling |
|---|---|---|
| 10001 | `Эж` | `3ж` |
| 10006 | `2` | `4хим(кола )` |
| 10008 | `Эж` | `3ж` |
| 10010 | `2` | `3ж,аром .` |
| 10014 | `Эмс` | `3жс` |

### hardness_total  (29 total disagreements)

| Order | Vision | Docling |
|---|---|---|
| 10004 | `45` | `7,47` |
| 10091 | `15` | `2,5` |
| 10213 | `55` | `9,13` |
| 10256 | `65` | `10,79` |
| 10290 | `40` | `6,64` |

### sulfides  (61 total disagreements)

| Order | Vision | Docling |
|---|---|---|
| 12634 | `не норм.` | `0,004` |
| 12827 | `0,002` | `0,009` |
| 12829 | `0,022` | `0,029` |
| 12959 | `0,004` | `0,006` |
| 13643 | `0,062` | `0,068` |

### hydrogen_sulfide  (32 total disagreements)

| Order | Vision | Docling |
|---|---|---|
| 10367 | `0,002` | `0,009` |
| 10379 | `0,002` | `0,009` |
| 10386 | `0,002` | `0,009` |
| 10393 | `0,002` | `0,009` |
| 10499 | `0,004` | `0,006` |

### permanganate_oxidizability  (21 total disagreements)

| Order | Vision | Docling |
|---|---|---|
| 11115 | `5,0` | `-` |
| 12634 | `5,0` | `2,0` |
| 16356 | `8,3` | `2,0` |
| 16495 | `0,8` | `3,0` |
| 16976 | `11,62` | `3,0` |

### nitrates  (29 total disagreements)

| Order | Vision | Docling |
|---|---|---|
| 10671 | `33,2` | `33,9` |
| 10978 | `36,2` | `36,9` |
| 11005 | `34,2` | `34,7` |
| 11115 | `45,0` | `-` |
| 11144 | `22,2` | `29,7` |

### temperature  (4 total disagreements)

| Order | Vision | Docling |
|---|---|---|
| 10575 | `15,1` | `До ВБ/После 15,1` |
| 10940 | `21,4` | `До 21,4` |
| 11404 | `15,9` | `ВП1 15,9` |
| 16448 | `22,8` | `22,₽` |

### fluorides  (6 total disagreements)

| Order | Vision | Docling |
|---|---|---|
| 10411 | `1,4Z` | `1,47` |
| 11863 | `1,4Z` | `1,47` |
| 12634 | `1,5` | `0,8` |
| 8398 | `0,5-1,5 (0,7)` | `-` |
| 9361 | `0,52` | `0,57` |

### magnesium  (7 total disagreements)

| Order | Vision | Docling |
|---|---|---|
| 10427 | `1,34` | `55` |
| 10461 | `2,97` | `90` |
| 19822 | `50` | `-` |
| 22440 | `50` | `-` |
| 8608 | `0,03` | `35` |

### electrical_conductivity  (1 total disagreements)

| Order | Vision | Docling |
|---|---|---|
| 12634 | `не норм.` | `516` |

## Top 20 unknown names (для расширения PARAM_SYNONYMS)

### Docling-side (text-layer варианты не в synonyms даже после preClean)
| Name | Count |
|---|---:|
| `Магний (Mg 2+` | 1867 |
| `Реакция среды pH` | 230 |
| `Цветность, град` | 230 |
| `Электропровод- ность воды` | 53 |
| `Фториды (по F)` | 52 |
| `Нитраты (поNO 3 - )` | 3 |
| `Цветность Мутность` | 1 |
| `ность` | 1 |
| `перманганатная Железо` | 1 |

### Vision-side (Vision-формы не в synonyms)
| Name | Count |
|---|---:|
| `Щёлочность перманганатная` | 18 |
| `Жёсткость постоянная` | 4 |
| `Щёлочность постоянная` | 4 |
| `Омеднение перманганатная` | 3 |
| `Кислотность общая` | 3 |
| `Омеляемость перманганатная` | 2 |
| `Сульфаты (S²⁻)` | 1 |
| `Омега-3 полиненасыщенная` | 1 |
| `Омнесканность перманганатная` | 1 |
| `Кислотность` | 1 |
| `Омолесность перманганатная` | 1 |
| `Жёсткость временная` | 1 |
