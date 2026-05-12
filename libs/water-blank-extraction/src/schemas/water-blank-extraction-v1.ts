import { z } from 'zod';

/**
 * WaterBlankExtractionV1 — Zod-схема для structured output из бланка
 * лабораторного анализа воды (шаблон ИП Ефимов / Аквафор).
 *
 * Используется в трёх местах:
 * 1. Flowise chatflow `water-analysis-extractor-vision-v1`, нода
 *    `advancedStructuredOutputParser` — поле `exampleJson` принимает Zod
 *    как код-в-строке. Содержимое этого файла после `z.object({...})` идёт
 *    в textarea ноды через MCP `flowise_chatflow_update`. Версия в
 *    `00-create-chatflow.ts:ZOD_SCHEMA_CODE` синхронизирована, но без
 *    кавычек/parens внутри describe (Flowise SecureZodSchemaParser).
 * 2. tsx-скрипты в `experiments/water-analysis-dataset/scripts/` — runtime-валидация
 *    Vision-ответа Flowise через `WaterBlankExtractionV1.parse(predictionResult.json)`
 *    перед записью в `WaterAnalysisRaw.visionPayload`.
 * 3. Docling extraction path (`parsers/docling-table-parser.ts`) мапит ответ Docling
 *    на этот же контракт — downstream `05-normalize.ts` не различает источник.
 *
 * Принципы:
 * - `nullish()` (null/undefined/value) — лаборатории заполняют по-разному,
 *   Vision пропускает отсутствующие поля по prompt'у, Docling возвращает
 *   только то что есть в text-layer (checkbox state, например, не видит).
 * - valueRaw/unitRaw СТРОКАМИ — нормализация в этапе 1.B (scripts/05-normalize.ts).
 * - Никаких enum'ов на raw-уровне (intakeType: string, не WaterSourceType).
 * - .describe() на каждом поле — Claude использует при extraction'е.
 */
export const WaterBlankExtractionV1 = z.object({
    blankNumber: z.string().nullish()
        .describe('Номер бланка/протокола как в документе (например, "№ 1234/21")'),
    sampleDate: z.string().nullish()
        .describe('Дата отбора пробы в формате YYYY-MM-DD'),
    testDate: z.string().nullish()
        .describe('Дата проведения анализа в формате YYYY-MM-DD'),

    customerName: z.string().nullish()
        .describe('ФИО заказчика'),
    customerPhone: z.string().nullish()
        .describe('Телефон заказчика — отделить от адреса (10-11 цифр, может быть с +7/8)'),
    objectAddress: z.string().nullish()
        .describe('ТОЛЬКО географический адрес объекта пробы (без телефона, ФИО, заметок)'),

    intakeType: z.string().nullish()
        .describe('Тип источника воды (только тип): скважина / колодец / родник / водопровод. Глубина — в depthMeters'),
    depthMeters: z.number().nullish()
        .describe('Глубина скважины или колодца в метрах (число без единиц)'),

    appearance: z.array(z.string()).nullish()
        .describe('Массив отмеченных checkbox описания внешнего вида: прозрачная / мутная / мутнеет со временем'),

    labName: z.string().nullish()
        .describe('Название лаборатории-исполнителя из header (например, ИП Ефимов А.В.)'),
    samplingPoint: z.string().nullish()
        .describe('Рукописная приписка точки отбора (после очистки, до фильтра, кран на кухне)'),
    conclusionText: z.string().nullish()
        .describe('Заключение лаборатории о соответствии СанПиН (опционально)'),
    customerNotes: z.string().nullish()
        .describe('Жалобы или заметки клиента (опционально)'),

    params: z.array(z.object({
        name: z.string()
            .describe('Каноничное название параметра (см. список в prompt)'),
        valueRaw: z.string()
            .describe('Значение строкой: "7.2", "8,3", "<0.1", ">10", "не обнаружено", "0,1-0,5"'),
        unitRaw: z.string().nullish()
            .describe('Единица измерения как написано: мг-экв/л, °Ж, ед. рН, мкСм/см'),
    })).describe('Все количественные параметры воды на бланке'),

    notes: z.string().nullish()
        .describe('Нестандартные пометки: рукописные правки лаборанта, нечитаемые места, печати, штампы'),
});

export type TWaterBlankExtractionV1 = z.infer<typeof WaterBlankExtractionV1>;
