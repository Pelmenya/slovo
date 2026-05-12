// @slovo/water-blank-extraction — нормализация water-analysis параметров.
//
// Слои:
//   - schemas/   — Zod-схема WaterBlankExtractionV1 (единый контракт Vision/Docling путей)
//   - sanpin/    — справочник СанПиН 1.2.3685-21 (PARAMS, PARAM_SYNONYMS, exceedsPdk)
//   - parsers/   — value-parser, unit-converter, clean-param-name, docling-table-parser,
//                  derive-intake-type
//   - normalize/ — water-analysis-normalizer (главная функция: TRawParam[] → WaterAnalysis params/flags/unknown)
//
// Будущее (TaskList #18 / Variant C продуктизация):
//   - 04-pre-clean / 05-ahunter-cleanse / 07-dealer-median ETL-скрипты при появлении новых datasets

export * from './schemas/water-blank-extraction-v1';
export * from './sanpin/sanpin-1-2-3685-21-v1.0.0';
export * from './parsers/value-parser';
export * from './parsers/unit-converter';
export * from './parsers/clean-param-name';
export * from './parsers/docling-table-parser';
export * from './parsers/derive-intake-type';
export * from './normalize/water-analysis-normalizer';
export * from './normalize/embedding-text-builder';
