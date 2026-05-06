// @slovo/water-blank-extraction — нормализация water-analysis параметров.
//
// На 2026-05-06 lib содержит только справочник СанПиН 1.2.3685-21.
// Будущие модули (по TaskList #18 / Variant C продуктизация):
//   - normalize/water-analysis-normalizer.service.ts — derive WaterAnalysisRaw → WaterAnalysis
//   - parsers/value-parser.ts — '<0.1' / 'не обнаружено' / диапазоны → number + flags
//   - parsers/unit-converter.ts — °Ж ↔ мг-экв/л, мкСм/см ↔ TDS, ...

export * from './sanpin/sanpin-1-2-3685-21-v1.0.0';
