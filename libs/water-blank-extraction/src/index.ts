// @slovo/water-blank-extraction — нормализация water-analysis параметров.
//
// Слои:
//   - sanpin/    — справочник СанПиН 1.2.3685-21 (PARAMS, PARAM_SYNONYMS, exceedsPdk)
//   - parsers/   — value-parser (valueRaw → number + flags), unit-converter (unit normalization)
//   - normalize/ — water-analysis-normalizer (главная функция: TRawParam[] → WaterAnalysis params/flags/unknown)
//
// Будущее (TaskList #18 / Variant C продуктизация):
//   - 04-pre-clean / 05-ahunter-cleanse / 07-dealer-median ETL-скрипты при появлении новых datasets

export * from './sanpin/sanpin-1-2-3685-21-v1.0.0';
export * from './parsers/value-parser';
export * from './parsers/unit-converter';
export * from './normalize/water-analysis-normalizer';
export * from './normalize/embedding-text-builder';
