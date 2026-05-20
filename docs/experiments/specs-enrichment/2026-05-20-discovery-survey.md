# Discovery survey — Аквафор PDF specs (Phase 1)

> **Сгенерировано:** 2026-05-20T12:47:22.472Z
> **Источник:** `experiments/specs-enrichment/specs/` (226 JSON-файлов) + `_discovery-journal/*.jsonl`
> **Pipeline:** docling /parse + /parse-rich + /render-pages → opus 4.7 multi-modal extraction → emergent schema.

## 1. Overview

- **Total PDFs обработано:** 226
- **Unique section types:** 115
- **Total section instances:** 1259
- **Unique model codes mentioned:** 372

## 2. PDFs per group + quality breakdown

| Group | Total | rich | partial | thin | scan-only | other |
|---|---:|---:|---:|---:|---:|---:|
| ro_system | 27 | 26 | 1 | 0 | 0 | 0 |
| softener | 8 | 8 | 0 | 0 | 0 | 0 |
| pre_filter | 7 | 7 | 0 | 0 | 0 | 0 |
| housing | 4 | 4 | 0 | 0 | 0 | 0 |
| flow_filter | 47 | 21 | 0 | 20 | 6 | 0 |
| cartridge | 57 | 42 | 3 | 0 | 12 | 0 |
| accessory | 23 | 17 | 2 | 0 | 4 | 0 |
| instruction_other | 12 | 0 | 0 | 12 | 0 | 0 |
| pitcher | 38 | 4 | 5 | 26 | 3 | 0 |
| other_product | 3 | 0 | 0 | 0 | 3 | 0 |

## 3. Section type frequency (global, top 50)

| Section type | Count | Example title |
|---|---:|---|
| `narrative_purpose` | 165 | Назначение |
| `tech_specs` | 144 | Технические характеристики |
| `installation_guide` | 107 | Установка смесителя |
| `package_contents` | 106 | Комплект поставки |
| `certifications` | 86 | Сертификация |
| `warranty` | 81 | Срок службы и гарантии |
| `technology_description` | 47 | Уникальные технологии очистки воды |
| `cartridge_replacement_schedule` | 44 | Срок службы (ресурс) фильтрующих модулей |
| `safety_warnings` | 35 | Предупреждения |
| `removal_efficiency` | 35 | Что удаляет |
| `troubleshooting` | 33 | Диагностика и устранение неисправностей |
| `compatibility` | 33 | Совместимость с системами |
| `cartridge_replacement` | 30 | Замена модуля |
| `compatible_cartridges` | 24 | Совместимые сменные модули |
| `removes` | 23 | Удаляемые загрязнения |
| `cartridge_lifespan` | 19 | Ресурс модуля |
| `regeneration_procedure` | 18 | Восстановление умягчающих свойств модуля Pro H |
| `regeneration_schedule` | 13 | Регенерация модуля Pro H — частота |
| `commissioning_procedure` | 13 | Промывка установки |
| `input_water_requirements` | 11 | Требования к исходной воде |
| `power_supply_specs` | 11 | Характеристики блока питания |
| `design_differences` | 8 | Отличия от обычных DWM |
| `narrative_advantages` | 7 | Bypass blending — регулировка степени умягчения |
| `installation_diagram_description` | 6 | Расположение отверстий и сборка (Рис. 2, Рис. 3) |
| `cartridge_replacement_procedure` | 6 | Инструкция по промывке Трио Норма |
| `usage_recommendations` | 5 | Рекомендации по эксплуатации и уходу |
| `regeneration_modes` | 5 | Режимы работы и регенерации |
| `color_codes` | 5 | Цветовая кодировка штуцера |
| `narrative_usage_recommendations` | 5 | Рекомендации по эксплуатации |
| `parts_list` | 4 | Детали смесителя (Рис. 1) |
| `model_variants` | 4 | Варианты исполнения |
| `maintenance_schedule` | 4 | Регулярный уход |
| `cartridge_collector_mapping` | 4 | Маркировка коллекторов |
| `compatible_systems` | 3 | Совместимые системы и схемы подключения |
| `compatible_housings` | 3 | Совместимые корпуса |
| `compatibility_matrix` | 3 | Матрица позиций модулей в водоочистителях |
| `led_indication_modes` | 3 | Режимы работы и индикация |
| `control_panel_modes` | 3 | Режимы работы блока управления (LED-дисплей) |
| `smart_features` | 3 | Умные функции |
| `antibacterial_certification` | 3 | Антибактериальная очистка |
| `support_contacts` | 3 | Сервис и поддержка |
| `model_differences` | 3 | WS1000 vs WS1000 P1 |
| `parts_diagram_description` | 2 | Детали смесителя (Рис. 1) |
| `iron_form_guide` | 2 | Формы железа — что умягчитель удаляет |
| `components_description` | 2 | Описание фильтра-диспенсера (Рис. 2) |
| `cartridge_role_breakdown` | 2 | Назначение каждого модуля |
| `module_descriptions` | 2 | Описание модулей |
| `common_specs` | 2 | Общие характеристики модулей |
| `manufacturer` | 2 | Производитель |
| `shelf_life` | 2 | Срок хранения |

<details><summary>Остальные 65 section types (tail)</summary>

| Section type | Count |
|---|---:|
| `cartridge_lifespan_indicator` | 2 |
| `manufacturer_info` | 2 |
| `operating_conditions` | 2 |
| `narrative_warnings` | 2 |
| `storage_conditions` | 2 |
| `error_codes` | 2 |
| `min_pressure_by_mineralization` | 2 |
| `additional_equipment_support` | 2 |
| `color_codes_flush_mode` | 2 |
| `hardness_compensation_table` | 2 |
| `cartridge_descriptions` | 1 |
| `drain_clamp_installation` | 1 |
| `sanitization` | 1 |
| `filtration_stages` | 1 |
| `display_controls` | 1 |
| `advanced_features` | 1 |
| `operational_recommendations` | 1 |
| `leak_protection` | 1 |
| `color_variants` | 1 |
| `product_variants` | 1 |
| `performance_by_tank_size` | 1 |
| `operating_parameters` | 1 |
| `regeneration_calculation` | 1 |
| `multi_language_support` | 1 |
| `technology_features` | 1 |
| `manufacturer_position` | 1 |
| `water_quality_requirements` | 1 |
| `low_pressure_solution` | 1 |
| `manufacturing_principle` | 1 |
| `bypass_adjustment` | 1 |
| `digital_flowmeter_feature` | 1 |
| `host_water_filter` | 1 |
| `compatible_cartridge_sets` | 1 |
| `pp5_replacement_procedure` | 1 |
| `safety_philosophy` | 1 |
| `compatible_cartridge_combinations` | 1 |
| `service_codes` | 1 |
| `components_inventory` | 1 |
| `controller_display_codes` | 1 |
| `controller_operation` | 1 |
| `model_lineup` | 1 |
| `hardness_advisory` | 1 |
| `rinse_procedure` | 1 |
| `pressure_requirements` | 1 |
| `model_cartridge_configurations` | 1 |
| `cartridge_replacement_signal` | 1 |
| `hygiene_maintenance` | 1 |
| `installation_modes` | 1 |
| `adapter_variants` | 1 |
| `hardness_compensation_formula` | 1 |
| `lid_variants` | 1 |
| `counter_operation` | 1 |
| `patented_technology` | 1 |
| `nsf_certification_data` | 1 |
| `internal_design` | 1 |
| `competitive_comparison` | 1 |
| `operating_room_requirements` | 1 |
| `tank_pressure_specs` | 1 |
| `system_components_legend` | 1 |
| `controller_features` | 1 |
| `installation_warning` | 1 |
| `flush_procedure` | 1 |
| `input_water_requirements_comparison` | 1 |
| `model_lineup_summary` | 1 |
| `controller_settings` | 1 |

</details>

## 4. Section types per group (top 15 per group)

### ro_system (201 section instances)

| Type | Count |
|---|---:|
| `tech_specs` | 27 |
| `narrative_purpose` | 24 |
| `package_contents` | 22 |
| `cartridge_replacement_schedule` | 19 |
| `warranty` | 19 |
| `troubleshooting` | 17 |
| `certifications` | 10 |
| `power_supply_specs` | 6 |
| `design_differences` | 6 |
| `technology_description` | 5 |
| `color_codes` | 4 |
| `cartridge_collector_mapping` | 4 |
| `compatible_cartridges` | 3 |
| `led_indication_modes` | 3 |
| `control_panel_modes` | 3 |
| _...еще 19 types_ | |

### softener (43 section instances)

| Type | Count |
|---|---:|
| `tech_specs` | 8 |
| `narrative_purpose` | 8 |
| `input_water_requirements` | 5 |
| `regeneration_modes` | 4 |
| `model_differences` | 3 |
| `hardness_compensation_table` | 2 |
| `design_differences` | 2 |
| `package_contents` | 2 |
| `troubleshooting` | 2 |
| `certifications` | 2 |
| `input_water_requirements_comparison` | 1 |
| `model_lineup_summary` | 1 |
| `error_codes` | 1 |
| `controller_settings` | 1 |
| `warranty` | 1 |

### pre_filter (72 section instances)

| Type | Count |
|---|---:|
| `narrative_purpose` | 7 |
| `tech_specs` | 7 |
| `package_contents` | 7 |
| `compatible_cartridges` | 7 |
| `installation_guide` | 7 |
| `cartridge_replacement` | 7 |
| `warranty` | 7 |
| `certifications` | 7 |
| `removal_efficiency` | 6 |
| `technology_description` | 3 |
| `commissioning_procedure` | 3 |
| `installation_diagram_description` | 2 |
| `safety_warnings` | 2 |

### housing (30 section instances)

| Type | Count |
|---|---:|
| `narrative_purpose` | 4 |
| `tech_specs` | 4 |
| `package_contents` | 4 |
| `installation_guide` | 4 |
| `cartridge_replacement` | 4 |
| `warranty` | 4 |
| `certifications` | 4 |
| `safety_warnings` | 1 |
| `installation_diagram_description` | 1 |

### flow_filter (264 section instances)

| Type | Count |
|---|---:|
| `narrative_purpose` | 28 |
| `tech_specs` | 24 |
| `package_contents` | 20 |
| `installation_guide` | 19 |
| `warranty` | 19 |
| `cartridge_replacement` | 19 |
| `regeneration_procedure` | 13 |
| `certifications` | 12 |
| `compatible_cartridges` | 11 |
| `commissioning_procedure` | 10 |
| `safety_warnings` | 10 |
| `removal_efficiency` | 9 |
| `technology_description` | 8 |
| `regeneration_schedule` | 7 |
| `cartridge_replacement_procedure` | 6 |
| _...еще 31 types_ | |

### cartridge (391 section instances)

| Type | Count |
|---|---:|
| `narrative_purpose` | 57 |
| `tech_specs` | 46 |
| `certifications` | 34 |
| `compatibility` | 33 |
| `package_contents` | 31 |
| `technology_description` | 29 |
| `removes` | 23 |
| `cartridge_replacement_schedule` | 20 |
| `cartridge_lifespan` | 19 |
| `removal_efficiency` | 19 |
| `safety_warnings` | 18 |
| `installation_guide` | 18 |
| `warranty` | 7 |
| `regeneration_schedule` | 4 |
| `compatible_cartridges` | 3 |
| _...еще 20 types_ | |

### accessory (162 section instances)

| Type | Count |
|---|---:|
| `narrative_purpose` | 23 |
| `tech_specs` | 20 |
| `package_contents` | 18 |
| `warranty` | 18 |
| `certifications` | 15 |
| `installation_guide` | 14 |
| `troubleshooting` | 8 |
| `parts_list` | 3 |
| `usage_recommendations` | 3 |
| `safety_warnings` | 3 |
| `input_water_requirements` | 3 |
| `parts_diagram_description` | 2 |
| `regeneration_schedule` | 2 |
| `regeneration_procedure` | 2 |
| `model_variants` | 2 |
| _...еще 22 types_ | |

### instruction_other (12 section instances)

| Type | Count |
|---|---:|
| `installation_guide` | 12 |

### pitcher (75 section instances)

| Type | Count |
|---|---:|
| `installation_guide` | 32 |
| `narrative_purpose` | 11 |
| `tech_specs` | 8 |
| `warranty` | 6 |
| `usage_recommendations` | 2 |
| `input_water_requirements` | 1 |
| `package_contents` | 1 |
| `iron_form_guide` | 1 |
| `hardness_compensation_formula` | 1 |
| `troubleshooting` | 1 |
| `error_codes` | 1 |
| `parts_list` | 1 |
| `lid_variants` | 1 |
| `counter_operation` | 1 |
| `certifications` | 1 |
| _...еще 6 types_ | |

### other_product (9 section instances)

| Type | Count |
|---|---:|
| `narrative_purpose` | 3 |
| `package_contents` | 1 |
| `installation_modes` | 1 |
| `adapter_variants` | 1 |
| `components_description` | 1 |
| `installation_guide` | 1 |
| `certifications` | 1 |

## 5. Section types **уникальные** для группы (встретились только в одной)

Полезно для understanding domain-specific extraction.

### ro_system

- `cartridge_collector_mapping` (4×)
- `led_indication_modes` (3×)
- `control_panel_modes` (3×)
- `smart_features` (3×)
- `antibacterial_certification` (3×)
- `support_contacts` (3×)
- `min_pressure_by_mineralization` (2×)
- `additional_equipment_support` (2×)
- `color_codes_flush_mode` (2×)
- `operating_room_requirements` (1×)
- `tank_pressure_specs` (1×)
- `system_components_legend` (1×)
- `controller_features` (1×)
- `installation_warning` (1×)
- `flush_procedure` (1×)

### softener

- `model_differences` (3×)
- `hardness_compensation_table` (2×)
- `input_water_requirements_comparison` (1×)
- `model_lineup_summary` (1×)
- `controller_settings` (1×)

### flow_filter

- `cartridge_replacement_procedure` (6×)
- `narrative_usage_recommendations` (5×)
- `cartridge_lifespan_indicator` (2×)
- `manufacturer_info` (2×)
- `operating_conditions` (2×)
- `narrative_warnings` (2×)
- `bypass_adjustment` (1×)
- `digital_flowmeter_feature` (1×)
- `host_water_filter` (1×)
- `compatible_cartridge_sets` (1×)
- `pp5_replacement_procedure` (1×)
- `safety_philosophy` (1×)
- `compatible_cartridge_combinations` (1×)
- `service_codes` (1×)
- `components_inventory` (1×)
- `controller_display_codes` (1×)
- `controller_operation` (1×)
- `model_lineup` (1×)
- `hardness_advisory` (1×)
- `rinse_procedure` (1×)
- `pressure_requirements` (1×)
- `model_cartridge_configurations` (1×)
- `cartridge_replacement_signal` (1×)
- `hygiene_maintenance` (1×)

### cartridge

- `compatibility` (33×)
- `removes` (23×)
- `cartridge_lifespan` (19×)
- `compatible_housings` (3×)
- `compatibility_matrix` (3×)
- `cartridge_role_breakdown` (2×)
- `module_descriptions` (2×)
- `common_specs` (2×)
- `multi_language_support` (1×)
- `technology_features` (1×)
- `manufacturer_position` (1×)
- `water_quality_requirements` (1×)
- `low_pressure_solution` (1×)
- `manufacturing_principle` (1×)

### accessory

- `parts_diagram_description` (2×)
- `cartridge_descriptions` (1×)
- `drain_clamp_installation` (1×)
- `sanitization` (1×)
- `filtration_stages` (1×)
- `display_controls` (1×)
- `advanced_features` (1×)
- `operational_recommendations` (1×)
- `leak_protection` (1×)
- `color_variants` (1×)
- `product_variants` (1×)
- `performance_by_tank_size` (1×)
- `operating_parameters` (1×)
- `regeneration_calculation` (1×)

### pitcher

- `hardness_compensation_formula` (1×)
- `lid_variants` (1×)
- `counter_operation` (1×)
- `patented_technology` (1×)
- `nsf_certification_data` (1×)
- `internal_design` (1×)
- `competitive_comparison` (1×)

### other_product

- `installation_modes` (1×)
- `adapter_variants` (1×)

## 6. Model codes — universe of mentioned products

Всего uniqueModelCodes: **372**.

### ro_system (52)

`APRO-100` · `APRO-100 PRO` · `APRO-100-1` · `DWM-101` · `DWM-101S` · `DWM-101SN` · `DWM-102S` · `DWM-102S Pro` · `DWM-106-31C-S4` · `DWM-201` · `DWM-202S` · `DWM-202S Pro` · `DWM-202S-C-LD` · `DWM-202S-CLD` · `DWM-202SN Pro` · `DWM-203` · `DWM-206S` · `DWM-206S-C` · `DWM-206SN` · `DWM-31` · `DWM-312-12M` · `DWM-312S Pro` · `DWM-41` · `DWM-411-12M-R4` · `DWM-411-12M-S4` · `DWM-412-12M-R4` · `DWM-412-12M-S4` · `DWM-70` · `DWM-701-12F-S2` · `DWM-701-12FM-S2` · `DWM-701S-FМ` · `DWM-702-12F-S2` · `DWM-702-12FM-S2` · `DWM-70S` · `DWM-80SN` · `DWM-80SN Pro` · `OSMO 50` · `OSMO Pro 100` · `OSMO Pro 50` · `Аквафор Морион` · `Аквафор ОСМО-050-6-А-М` · `Аквафор ОСМО-100-5-А` · `Аквафор ОСМО-100-5-А-ПН` · `Аквафор ОСМО-100-6-А-М` · `Аквафор ОСМО-100-6-А-М-ПН` · `Аквафор-ОСМО-050-5` · `Аквафор-ОСМО-050-5-Б` · `Аквафор-ОСМО-050-6-Б-М` · `Аквафор-ОСМО-100-5-Б` · `Аквафор-ОСМО-100-6-Б-М` · `Аквафор-Осмо-М-050-4-Б-М-Н-Г` · `ОСМО 100`

### softener (10)

`WS1000` · `WS1000 P1` · `WS1000 А` · `WS500` · `WS500 P1` · `WS800` · `WS800 P1` · `Аквафор Extra Soft` · `Аквафор Акваэффект` · `СВП-MR-1054F/FAM-70-ST1`

### pre_filter (18)

`Viking` · `Viking Midi` · `Viking Midi Pro` · `Viking Mini` · `Viking Pro` · `Viking Pro RF` · `Viking S` · `Аквафор Slim 1/2"` · `Аквафор Slim 3/4"` · `Викинг` · `Викинг 300` · `Викинг Pro` · `Викинг Pro (РФ)` · `Викинг S` · `Викинг Миди` · `Викинг Миди 300` · `Викинг Миди Pro` · `Викинг Мини`

### housing (6)

`Гросс (20")` · `Гросс Миди (10")` · `Корпус предфильтра Аквафор (армированный)` · `Корпус предфильтра Аквафор Гросс (10") соединение 1"` · `Корпус предфильтра Аквафор Гросс (20") соединение 1"` · `Корпус предфильтра Аквафор для холодной воды`

### flow_filter (89)

`Aquaphor Favorit` · `Aquaphor Favorit Pro` · `Aquaphor Resto` · `Aquaphor Resto Pro` · `B300` · `Crystal Quadro` · `Crystal Soft` · `ECO H Pro` · `ECO Pro` · `J.SHMIDT 500` · `J.SHMIDT 501` · `JS 500` · `KHC` · `LWM-205S` · `LWM-205S UV` · `LWM-205S-DMC (UV)` · `А500 J. Shmidt` · `А500 J.SHMIDT` · `Аквафор B300` · `Аквафор B300 усиленный бактерицидной добавкой` · `Аквафор Baby H Pro` · `Аквафор Baby Pro` · `Аквафор KHC` · `Аквафор LWM-205S-DMC` · `Аквафор Кристалл ECO H Pro` · `Аквафор Кристалл ECO Pro` · `Аквафор Кристалл Soft` · `Аквафор Кристалл Квадро` · `Аквафор Кристалл Соло` · `Аквафор Кристалл Соло B` · `Аквафор Кристалл ЭКО Н` · `Аквафор Лайн` · `Аквафор МОДЕРН (исполнение 2)` · `Аквафор Модерн` · `Аквафор Модерн исполнение 1` · `Аквафор Модерн исполнение 2` · `Аквафор Модерн исполнение 4` · `Аквафор Стирон` · `Аквафор Трио` · `Аквафор Трио FE` · `Аквафор Трио FE для жёсткой воды` · `Аквафор Трио Fe` · `Аквафор Трио Fe H` · `Аквафор Трио Норма` · `Аквафор Трио Норма для жёсткой воды` · `Аквафор Трио Умягчающий` · `Аквафор Фаворит` · `Аквафор Фаворит Pro` · `Аквафор Фаворит ЭКО` · `Аквафор Фонтанчик Кристалл ЭКО-80-2` · `КК-1` · `КК-10` · `КК-11` · `КК-12` · `КК-13` · `КК-14` · `КК-15` · `КК-16` · `КК-17` · `КК-2` · `КК-3` · `КК-4` · `КК-5` · `КК-6` · `КК-7` · `КК-8` · `КК-9` · `Кристалл` · `Кристалл (Classic)` · `Кристалл Baby H Pro` · `Кристалл Baby Pro` · `Кристалл ECO H` · `Кристалл А` · `Кристалл А для жесткой воды` · `Кристалл Квадро` · `Кристалл Н` · `Кристалл Соло` · `Кристалл Эко` · `Кристалл Эко Н` · `Кристалл-Квадро` · `Кристалл-Квадро 2H` · `Кристалл-Квадро B` · `Кристалл-Квадро H` · `Кристалл-Квадро HB` · `Стирон` · `Трио H` · `Трио Норма` · `Трио Норма H` · `Трио Норма умягчающий`

### cartridge (99)

`1000 GPD` · `1000 галлонов` · `B100-15` · `B100-25` · `B150 PRO` · `B150 Миди` · `B150 Плюс` · `B150 Фаворит ЭКО` · `B150 ЭКО` · `B5` · `B505 PRO` · `B505-13` · `B505-14` · `B510-12` · `B510-12 AS` · `B515 PRO` · `B515 PRO AS` · `B515-13` · `B515-14` · `B515-ПГ5` · `B515-ПХ5` · `B520 PRO` · `B520 Викинг` · `B520-04` · `B520-12` · `B520-12 AS` · `B520-13` · `B520-14` · `B520-ПГ20` · `B520-ПГ5` · `B520-ПХ20` · `City` · `DMC` · `K3-K2-K7` · `K3-KH-K7` · `K5-K2-K7` · `K5-KH-K7` · `K7B` · `K7F` · `KH` · `KO-100S` · `KO-150` · `KO-50` · `KO-50S` · `KO100` · `KO50` · `KP5` · `OSMO-K-100` · `OSMO-K-50` · `PP-10-10` · `PP-10-20` · `PP-5-10` · `PP-5-20` · `PRO 100` · `PRO 50` · `Pro 1` · `Pro 1 - Pro 100 - Pro Mg` · `Pro 1 - Pro 50 - Pro Mg` · `Pro 100` · `Pro 50` · `Pro Mg` · `TOPAZ` · `Аквафор Кристалл Soft` · `Аквафор Кристалл ЭКО` · `Аквафор Кристалл ЭКО умягчающий` · `Аквафор ОСМО Кристалл-050-4-М` · `Аквафор ОСМО Кристалл-100-4-М` · `В100-15` · `В100-25` · `В5` · `В520 спиральный` · `В520-04` · `В520-12` · `К2` · `К3` · `К5` · `К7` · `К7B` · `К7F` · `К7В` · `К7М` · `К8` · `КН` · `КО-150` · `КО-50` · `КО-50S` · `КО100` · `КО100S` · `КО50` · `КО50S` · `КПД` · `КПД исп.1` · `КПД исп.2` · `КР` · `КР5` · `Минерализатор` · `Сити` · `Топаз` · `ЭКО К7В`

### accessory (48)

`60LB-F-D (Кристалл Н)` · `60LB-F-D (Кристалл ЭКО)` · `60LB-F-D (Кристалл)` · `82138C` · `82320-1C` · `Baby Pro` · `C125` · `C126` · `CDZ0246` · `ECO H Pro` · `ECO Pro` · `F0122A` · `HF-D` · `HF-D (ОСМО Pro 100)` · `I400` · `I400P1` · `PJ-V6010` · `PS1(SODA)-F-D (Кристалл КВАДРО)` · `PS1(SODA)-F-D (Кристалл ЭКО Н)` · `PS1(SODA)-F-D (ОСМО-К-100-4)` · `PS1(SODA)-F-D (ОСМО-К-100-4-М)` · `PS1-F-D (Кристалл КВАДРО)` · `PS1-F-D (Кристалл ЭКО Н)` · `PS1-F-D (ОСМО-К-100-4)` · `PS1-F-D (ОСМО-К-100-4-М)` · `PSW-H` · `PSW-L` · `WF-D (ECO H Pro)` · `WF-D (ECO Pro)` · `WF-D (OSMO Pro 100)` · `WLG1202-004` · `WLG1301-010` · `WLG1301-011` · `WaterBoss 400` · `WaterBoss 400 (P1)` · `Аквафор Юник 10` · `Аквафор Юник 20` · `Аквафор Юник 5` · `Аквафор Юник БИО` · `КПД (100 GPD)` · `КПД (50 GPD)` · `КПД 100 GPD` · `КПД 100 GPD на раме` · `КПД 50 GPD` · `Кран с керамической парой (исп. 3)` · `Кристалл ЭКО-80-2` · `Тройник с шаровым клапаном 1/2"×1/2"×1/4"` · `Фонтанчик питьевой воды`

### instruction_other (12)

`A5` · `A6` · `A7` · `A8` · `B15` · `B16` · `B25` · `B5` · `B6` · `B7` · `B8` · `J.SHMIDT 500`

### pitcher (43)

`A1000` · `A5` · `A6` · `A7` · `A8` · `A800` · `Agate` · `Aquamarine` · `Art` · `Art (А5 модуль)` · `Atlant` · `Atlant (А5 модуль)` · `B100-15` · `B100-25` · `B100-5` · `B15` · `B5 (B100-5)` · `B6 (B100-6)` · `B7 (B100-7)` · `B8 (B100-8)` · `Bottle City` · `Country` · `Country (А5 модуль)` · `D5` · `Garry` · `Garry (А5 модуль)` · `Gratis` · `Ideal A100` · `Ideal B15` · `Indie (А6 модуль)` · `Marseilles` · `Orlean` · `Premium` · `Prestige` · `Prestige (А5 модуль)` · `Provance` · `Real` · `Smile` · `Standart` · `Triumf` · `Ultra` · `Ultra (А5 модуль)` · `Аквафор Сити`

### other_product (7)

`PTS-2100-F (Кристалл Н)` · `PTS-2100-F (Кристалл ЭКО)` · `PTS-2100-F (Кристалл)` · `PTS-2100-F (ОСМО-К-100-3)` · `PTS-2100-F (ОСМО-К-100-3-М)` · `Аквафор Универсал` · `ЭФГ 63.250-20`

## 7. Rich notable examples (по 3 на группу, sorted by section count)

### ro_system

- **DWM-202S_PRO_v1_Pro_preview.pdf** — 14 sections, models: DWM-202S Pro, DWM-202S-C-LD, tech: reverse_osmosis, post_mineralization, built_in_tank, booster_pump, tds_sensor, wifi_smart, antibacterial_hollow_fiber
- **DWM-202S.pdf** — 13 sections, models: DWM-202S, tech: reverse_osmosis, post_mineralization, built_in_tank, booster_pump
- **DWM-202S_PRO_v2_01-25.pdf** — 13 sections, models: DWM-202S Pro, DWM-202S-C-LD, tech: reverse_osmosis, post_mineralization, built_in_tank, booster_pump, tds_sensor, led_display, antibacterial_hollow_fiber

### softener

- **WS500-WS500_P1_v2.pdf** — 9 sections, models: WS500, WS500 P1, tech: ion_exchange, sodium_cation, automatic_regeneration, smart_metering, three_mode_regen
- **Акваэффект_паспорт.pdf** — 8 sections, models: Аквафор Акваэффект, СВП-MR-1054F/FAM-70-ST1, tech: ion_exchange, sodium_cation, automatic_regeneration, iron_removal, manganese_removal, external_salt_tank
- **WS800_WS800_P1_v3.pdf** — 6 sections, models: WS800, WS800 P1, tech: ion_exchange, sodium_cation, automatic_regeneration, smart_metering, three_mode_regen

### pre_filter

- **Viking_pasport_RU_24-08-2020_print.pdf** — 12 sections, models: Викинг, Викинг Миди, Викинг Мини, Viking, Viking Midi, Viking Mini, tech: mechanical_prefiltration, carbon_block_B505_B515_B520, AQUALEN_ionexchange_fiber, B150_polishing, cold_or_hot_water
- **Viking_Midi_PRO_RU_print.pdf** — 11 sections, models: Викинг Миди Pro, Viking Midi Pro, tech: mechanical_prefiltration, deep_purification, carbon_block_B515, B150_aqualen
- **Viking_passport_RU_2023.pdf** — 11 sections, models: Викинг 300, Викинг Миди 300, Викинг Мини, tech: mechanical_prefiltration, carbon_block_B505_B515_B520_Pro, AQUALEN_ionexchange_fiber, B150_polishing, cold_or_hot_water

### housing

- **Korp_arm_2022_print.pdf** — 8 sections, models: Корпус предфильтра Аквафор (армированный), tech: mechanical_prefiltration, housing_for_10inch_cartridge
- **корпус_gross_10_PRINT.pdf** — 8 sections, models: Гросс Миди (10"), Корпус предфильтра Аквафор Гросс (10") соединение 1", tech: mechanical_prefiltration, housing_for_10inch_cartridge, g1_connection, air_release_button
- **korpus_predf_print.pdf** — 7 sections, models: Корпус предфильтра Аквафор для холодной воды, tech: mechanical_prefiltration, housing_for_10inch_cartridge, quick_connect_g34

### flow_filter

- **Crystal_ECO_Pro_v3_20-09-2024.pdf** — 13 sections, models: Аквафор Кристалл ECO Pro, Аквафор Кристалл ECO H Pro, ECO Pro, ECO H Pro, tech: sorption_filtration, hollow_fiber_membrane, Pro_series_modules, Pro_B_bacteria_removal_100pct, DFS_silver, AQUALEN, ion_exchange_softening_Pro_H, carbon_block_patent_2282494
- **Resto_v1__1___1_.pdf** — 13 sections, models: Aquaphor Resto, Aquaphor Resto Pro, tech: reverse_osmosis, booster_pump, controller_with_tds_sensor, recirculation, commercial_grade
- **Baby_PRO__Baby_H_PRO_.pdf** — 12 sections, models: Аквафор Baby Pro, Аквафор Baby H Pro, Кристалл Baby Pro, Кристалл Baby H Pro, tech: sorption_filtration, Pro_3_pharma_removal, antibiotics_hormones_99pct, AQUALEN, DFS_silver, STC_food_grade, pediatric_recommendation, CFB_carbon_block_patent_2282494

### cartridge

- **CrystEco.pdf** — 11 sections, models: Аквафор Кристалл ЭКО, Аквафор Кристалл ЭКО умягчающий, tech: hollow_fiber_membrane, carbonblock, aqualen_fiber, cfb, dfs_silver, click_and_turn, ion_exchange
- **pasport_B520_04.pdf** — 11 sections, models: В520-04, B520-04, tech: ion_exchange_resin, softening, regenerable_with_salt
- **B150_EKO.pdf** — 10 sections, models: B150 ЭКО, B150 Фаворит ЭКО, tech: hollow_fiber_membrane, carbonblock, aqualen_fiber, sorption

### accessory

- **complect_Pro_15-01-2021_preview__2_.pdf** — 11 sections, models: ECO Pro, Baby Pro, ECO H Pro, tech: pro_cartridges, aqualen, carbon_block_cfb, silver_dfs, uf_membrane, ion_exchange_resin, auto_lock
- **Dispenser_WF-D_v2_print.pdf** — 11 sections, models: WF-D (ECO Pro), WF-D (ECO H Pro), WF-D (OSMO Pro 100), tech: filter_dispenser, compressor_cooling, hot_water_85_95C, cold_water_6_10C, pro_cartridges, reverse_osmosis_optional
- **PS1-F-D_instruction.pdf** — 11 sections, models: PS1-F-D (Кристалл КВАДРО), PS1-F-D (Кристалл ЭКО Н), PS1-F-D (ОСМО-К-100-4), PS1-F-D (ОСМО-К-100-4-М), PS1(SODA)-F-D (Кристалл КВАДРО), PS1(SODA)-F-D (Кристалл ЭКО Н), PS1(SODA)-F-D (ОСМО-К-100-4), PS1(SODA)-F-D (ОСМО-К-100-4-М), tech: filter_dispenser, compressor_cooling, leak_stop_protection, co2_sparkling_water_optional, kristal_kvadro_compatible, kristal_eco_h_compatible, osmo_k_100_4_compatible

### pitcher

- **pasport_A800-A1000_22-01-2020_NO_NSF_SMALL.pdf** — 9 sections, models: A800, A1000, tech: softening, ion_exchange_monodisperse, iron_removal_fe2, manganese_removal, intelligent_regeneration, smart_metered_regeneration, high_efficiency, compact_softener
- **passport_pitcher_a5.pdf** — 7 sections, models: A5, B5 (B100-5), B6 (B100-6), B7 (B100-7), B8 (B100-8), D5, tech: pitcher_filter, aqualen_fiber, silver_bacteriostatic, activated_carbon, magnesium_enrichment, slider_lid, flip_flop_lid
- **presentation_a800_preview.pdf** — 6 sections, models: A800, tech: softening, ion_exchange_super_fine, iron_removal_fe2, manganese_removal, counterflow_regeneration, compressed_bed_filtration, removable_valve, patented_distributor, intelligent_controller, nsf_44_certified

## 8. Schema-input для Step 6 (chunks builder)

### Канонические section types (≥10 instances, candidates для metadata.section_type filter)

| Type | Count | Use case в AI retrieval |
|---|---:|---|
| `narrative_purpose` | 165 | |
| `tech_specs` | 144 | |
| `installation_guide` | 107 | |
| `package_contents` | 106 | |
| `certifications` | 86 | |
| `warranty` | 81 | |
| `technology_description` | 47 | |
| `cartridge_replacement_schedule` | 44 | |
| `safety_warnings` | 35 | |
| `removal_efficiency` | 35 | |
| `troubleshooting` | 33 | |
| `compatibility` | 33 | |
| `cartridge_replacement` | 30 | |
| `compatible_cartridges` | 24 | |
| `removes` | 23 | |
| `cartridge_lifespan` | 19 | |
| `regeneration_procedure` | 18 | |
| `regeneration_schedule` | 13 | |
| `commissioning_procedure` | 13 | |
| `input_water_requirements` | 11 | |
| `power_supply_specs` | 11 | |

### Rare / one-off types (1-3 instances, низкая частота)

82 types встретились ≤3 раза. Они **полезны** (например `hardness_compensation_formula`, `led_indicator_colors`, `service_codes`), но specific. Не нужны как filter primitives — в chunks как narrative content.

## 9. Killer discoveries (manual highlight)

Замечательные findings от agents:

- **Baby PRO** (`Baby_PRO__Baby_H_PRO_.pdf`) — **99.9% защита от антибиотиков, 99.8% от гормонов** (Pro 3 модуль). Уникальный selling point для детской / медицинской аудитории.
- **17-variant КК-1...КК-17 private label** (`Паспорт_водоочиститель_КК_в5__1_.pdf`) — Aquaphor International OÜ Эстония, каждая модель с уникальной модульной конфигурацией.
- **LWM-205S-DMC** — единственная Lab установка Type 1 ASTM (18.2 МОм·см), service passwords 1975/1200/1970.
- **Кристалл ЭКО Н** — японская half-fiber мембрана **JIS S 3201:2004**.
- **Modern degradation matrix** — `removal_efficiency` % при 20/50/80/120% использованного ресурса. AI знает «когда менять модули по факту».
- **Color codes families** для cartridge compatibility:
    - Оранжевый = PRO
    - Синий = standard 12-series
    - Красный = hot water -14
    - Без цвета = ПГ/ПХ полипропилен
- **min_pressure_by_mineralization** таблицы в каждом RO системе (DWM/OSMO) — критично для AI «жёсткая вода».
- **Chemistry linking layer**: каждый картридж знает что фильтрует (хлор / Fe / Mn / нитраты / жёсткость / органика / бактерии), patogen strains — E. coli 1257 / Enterobacter cloacae / Pseudomonas aeruginosa / Lamblia intestinalis / MS2 phage (вирусы).

## 10. Aggregate statistics

- **Total specs JSON size:** 1049 KB (~1.02 MB)
- **Average sections per PDF:** 5.6
- **Section types diversity ratio:** 115 types / 226 PDFs = 0.51 (emergent schema rate)
