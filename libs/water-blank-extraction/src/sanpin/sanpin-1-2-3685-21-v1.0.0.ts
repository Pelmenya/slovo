/**
 * Справочник нормативов качества питьевой воды.
 *
 * Источник: СанПиН 1.2.3685-21 «Гигиенические нормативы и требования к обеспечению
 * безопасности и (или) безвредности для человека факторов среды обитания»,
 * утв. Постановлением Главного государственного санитарного врача РФ
 * от 28.01.2021 N 2 (зарегистрировано в Минюсте России 29.01.2021 N 62296).
 * Введён в действие с 01.03.2021, срок действия до 01.03.2027.
 *
 * Извлечено из Раздела III «Нормативы качества и безопасности воды»:
 *   - Таблица 3.1  — Органолептические показатели качества вод (стр. 408)
 *   - Таблица 3.3  — Обобщённые показатели качества вод (стр. 411)
 *   - Таблица 3.13 — ПДК химических веществ в воде питьевой (стр. 420+)
 *
 * Не извлекалось: разделы про атмосферный воздух, почву, шум, радиацию,
 * аэрозоли, физические факторы — вне scope для water-analysis.
 *
 * Пометки в исходном документе:
 *   <в>   — все растворимые в воде формы
 *   <м>   — вещества, поступающие в воду в результате водоподготовки
 *           или миграции из материалов и реагентов
 *   <**>  — величина для воды питьевой системы централизованного
 *           водоснабжения (для систем с водоподготовкой)
 *   <к>   — канцерогены
 *
 * Лимитирующие показатели:
 *   с.-т. — санитарно-токсикологический
 *   общ.  — общесанитарный
 *   орг.  — органолептический (зап./окр./привк./мутн./пена/пл./оп.)
 */

export type TLimitingIndicator =
    | 'sanitary_toxicological' // с.-т.
    | 'general_sanitary'        // общ.
    | 'organoleptic'            // орг. (без расшифровки)
    | 'organoleptic_smell'      // орг. зап.
    | 'organoleptic_color'      // орг. окр.
    | 'organoleptic_taste'      // орг. привк.
    | 'organoleptic_turbidity'  // орг. мутн.
    | 'organoleptic_foam'       // орг. пена
    | 'organoleptic_film'       // орг. пл.
    | 'organoleptic_opalescence'; // орг. оп.

export type TWaterParam = {
    paramCode: string;
    nameRu: string;
    nameEn: string;
    unit: string;
    category: 'organoleptic' | 'general' | 'inorganic' | 'physical';

    /**
     * Базовое ПДК. Для централизованного водоснабжения (Раздел III, табл. 3.1, 3.3)
     * либо общее ПДК для всех систем (табл. 3.13). Если параметр не нормируется
     * СанПиН 1.2.3685-21 — `null`.
     */
    pdk: number | { min: number; max: number } | null;

    /**
     * Расширенное ПДК. Используется для значений с пометкой <**>
     * (вода централизованного водоснабжения с водоподготовкой) либо
     * для нецентрализованного водоснабжения (табл. 3.1, 3.3, где значения
     * для центр./нецентр. систем разнесены по строкам).
     *
     * NB: В СанПиН 1.2.3685-21 нет понятия «по решению санврача» из старого
     * СанПиН 2.1.4.1074-01 — `pdkExtended` здесь означает либо более мягкий
     * порог для конкретной категории водоснабжения.
     */
    pdkExtended: number | null;

    pdkSource: 'sanpin_1_2_3685_21' | 'sanpin_2_1_4_1074_01' | 'who' | 'physiological' | null;

    /** Класс опасности 1-4 (только для химических веществ табл. 3.13). */
    hazardClass: 1 | 2 | 3 | 4 | null;

    /** Лимитирующий показатель вредности (только для табл. 3.13). */
    limitingIndicator: TLimitingIndicator | null;

    /** true — параметр имеет ПДК в СанПиН 1.2.3685-21. */
    regulated: boolean;

    /** Физиологический диапазон (для не нормируемых СанПиН — взять из ВОЗ/учебников). */
    referenceRangeMin: number | null;
    referenceRangeMax: number | null;

    /** Точная ссылка на пункт документа для аудита. */
    sanpinSection: string;

    notes?: string;
};

export const SANPIN_1_2_3685_21_VERSION = '1.0.0';
export const SANPIN_1_2_3685_21_DOC_DATE = '2021-01-28';
export const SANPIN_1_2_3685_21_VALID_UNTIL = '2027-03-01';

export const WATER_PARAMS: TWaterParam[] = [
    // ============================================================================
    // ОРГАНОЛЕПТИЧЕСКИЕ ПОКАЗАТЕЛИ (Таблица 3.1)
    // ============================================================================
    {
        paramCode: 'odor',
        nameRu: 'Запах',
        nameEn: 'Odor',
        unit: 'балл',
        category: 'organoleptic',
        pdk: 2,
        pdkExtended: 3,
        pdkSource: 'sanpin_1_2_3685_21',
        hazardClass: null,
        limitingIndicator: null,
        regulated: true,
        referenceRangeMin: 0,
        referenceRangeMax: 2,
        sanpinSection: 'Раздел III, Таблица 3.1, п. 1',
        notes: 'pdk=2 для централизованного водоснабжения; pdkExtended=3 для нецентрализованного. Шкала 0-5 баллов.',
    },
    {
        paramCode: 'color',
        nameRu: 'Цветность',
        nameEn: 'Color',
        unit: 'градус',
        category: 'organoleptic',
        pdk: 20,
        pdkExtended: 30,
        pdkSource: 'sanpin_1_2_3685_21',
        hazardClass: null,
        limitingIndicator: null,
        regulated: true,
        referenceRangeMin: 0,
        referenceRangeMax: 20,
        sanpinSection: 'Раздел III, Таблица 3.1, п. 3',
        notes: 'pdk=20 для централизованного водоснабжения и плавательных бассейнов; pdkExtended=30 для нецентрализованного. Для аквапарков — 5.',
    },
    {
        paramCode: 'turbidity',
        nameRu: 'Мутность',
        nameEn: 'Turbidity',
        unit: 'ЕМФ',
        category: 'organoleptic',
        pdk: 2.6,
        pdkExtended: null,
        pdkSource: 'sanpin_1_2_3685_21',
        hazardClass: null,
        limitingIndicator: null,
        regulated: true,
        referenceRangeMin: 0,
        referenceRangeMax: 2.6,
        sanpinSection: 'Раздел III, Таблица 3.1, п. 5',
        notes: 'pdk=2.6 ЕМФ по формазину или 1.5 мг/л по каолину для центр./нецентр. водоснабжения и плавательных бассейнов. Для аквапарков — 1.0 мг/л (каолин). NB: в исходном тексте документа — именно 2.6 ЕМФ (формазин), не 1.5 ЕМФ как в некоторых вторичных источниках. Если лаборатория сдаёт в мг/л (каолин) — применять норматив 1.5 мг/л.',
    },

    // ============================================================================
    // ОБОБЩЁННЫЕ ПОКАЗАТЕЛИ (Таблица 3.3)
    // ============================================================================
    {
        paramCode: 'tds',
        nameRu: 'Общая минерализация (сухой остаток)',
        nameEn: 'Total dissolved solids',
        unit: 'мг/л',
        category: 'general',
        pdk: 1000,
        pdkExtended: 1500,
        pdkSource: 'sanpin_1_2_3685_21',
        hazardClass: null,
        limitingIndicator: null,
        regulated: true,
        referenceRangeMin: 100,
        referenceRangeMax: 1000,
        sanpinSection: 'Раздел III, Таблица 3.3, п. 1',
        notes: 'pdk=1000 мг/л для централизованного водоснабжения; pdkExtended=1500 для нецентрализованного. Нижний физиологический оптимум ~100-300 мг/л (рекомендации ВОЗ).',
    },
    {
        paramCode: 'hardness_total',
        nameRu: 'Жёсткость общая',
        nameEn: 'Total hardness',
        unit: 'мг-экв/л',
        category: 'general',
        pdk: 7.0,
        pdkExtended: 10.0,
        pdkSource: 'sanpin_1_2_3685_21',
        hazardClass: null,
        limitingIndicator: null,
        regulated: true,
        referenceRangeMin: 1.5,
        referenceRangeMax: 7.0,
        sanpinSection: 'Раздел III, Таблица 3.3, п. 2',
        notes: 'pdk=7.0 мг-экв/л (=°Ж) для централизованного водоснабжения; pdkExtended=10.0 для нецентрализованного. В документе единица — мг-экв/дм³, тождественна °Ж в российской практике (1 мг-экв/л = 1 °Ж).',
    },
    {
        paramCode: 'permanganate_oxidizability',
        nameRu: 'Перманганатная окисляемость',
        nameEn: 'Permanganate oxidizability',
        unit: 'мг/л',
        category: 'general',
        pdk: 5.0,
        pdkExtended: 7.0,
        pdkSource: 'sanpin_1_2_3685_21',
        hazardClass: null,
        limitingIndicator: null,
        regulated: true,
        referenceRangeMin: 0,
        referenceRangeMax: 5.0,
        sanpinSection: 'Раздел III, Таблица 3.3, п. 4',
        notes: 'pdk=5.0 мг/л для централизованного водоснабжения; pdkExtended=7.0 для нецентрализованного. Для аквапарков — 7.5 мг/л.',
    },
    {
        paramCode: 'ph',
        nameRu: 'Водородный показатель',
        nameEn: 'pH',
        unit: 'ед.',
        category: 'general',
        pdk: { min: 6.0, max: 9.0 },
        pdkExtended: null,
        pdkSource: 'sanpin_1_2_3685_21',
        hazardClass: null,
        limitingIndicator: null,
        regulated: true,
        referenceRangeMin: 6.0,
        referenceRangeMax: 9.0,
        sanpinSection: 'Раздел III, Таблица 3.3, п. 6',
        notes: 'Диапазон 6.0-9.0 для централизованного и нецентрализованного водоснабжения, водоисточников хозяйственно-бытового и рекреационного водопользования. Для морской воды — 6.5-8.5.',
    },

    // ============================================================================
    // НЕОРГАНИЧЕСКИЕ ВЕЩЕСТВА (Таблица 3.13 — ПДК химических веществ)
    // ============================================================================
    {
        paramCode: 'ammonium',
        nameRu: 'Аммиак / аммоний-ион (NH3 / NH4+)',
        nameEn: 'Ammonia / ammonium ion',
        unit: 'мг/л',
        category: 'inorganic',
        pdk: 1.5,
        pdkExtended: 2.0,
        pdkSource: 'sanpin_1_2_3685_21',
        hazardClass: 4,
        limitingIndicator: 'organoleptic_smell',
        regulated: true,
        referenceRangeMin: 0,
        referenceRangeMax: 1.5,
        sanpinSection: 'Раздел III, Таблица 3.13, п. 106',
        notes: 'CAS 7664-41-7. Помечено <м> (миграция из реагентов водоподготовки). pdk=1.5 мг/л — общий норматив; pdkExtended=2.0 — для воды централизованного водоснабжения (пометка <**> в документе).',
    },
    {
        paramCode: 'iron_total',
        nameRu: 'Железо (Fe, суммарно)',
        nameEn: 'Iron (total)',
        unit: 'мг/л',
        category: 'inorganic',
        pdk: 0.3,
        pdkExtended: null,
        pdkSource: 'sanpin_1_2_3685_21',
        hazardClass: 3,
        limitingIndicator: 'organoleptic',
        regulated: true,
        referenceRangeMin: 0,
        referenceRangeMax: 0.3,
        sanpinSection: 'Раздел III, Таблица 3.13, п. 556',
        notes: 'Помечено <в> (все растворимые формы) <м> (миграция из реагентов). Норматив един для всех систем водоснабжения. Включает Fe²⁺ и Fe³⁺ суммарно.',
    },
    {
        paramCode: 'iron_2plus',
        nameRu: 'Железо двухвалентное (Fe²⁺)',
        nameEn: 'Iron (II) / Ferrous iron',
        unit: 'мг/л',
        category: 'inorganic',
        pdk: null,
        pdkExtended: null,
        pdkSource: null,
        hazardClass: null,
        limitingIndicator: null,
        regulated: false,
        referenceRangeMin: null,
        referenceRangeMax: null,
        sanpinSection: 'Не нормируется отдельно',
        notes: 'СанПиН 1.2.3685-21 не нормирует Fe²⁺ как отдельный параметр — покрыт суммарным железом (см. iron_total, ПДК 0.3 мг/л). Для оценки превышения использовать норматив для общего железа.',
    },
    {
        paramCode: 'manganese',
        nameRu: 'Марганец (Mn, суммарно)',
        nameEn: 'Manganese',
        unit: 'мг/л',
        category: 'inorganic',
        pdk: 0.1,
        pdkExtended: null,
        pdkSource: 'sanpin_1_2_3685_21',
        hazardClass: 3,
        limitingIndicator: 'organoleptic_color',
        regulated: true,
        referenceRangeMin: 0,
        referenceRangeMax: 0.1,
        sanpinSection: 'Раздел III, Таблица 3.13, п. 717',
        notes: 'Помечено <в> <м>. Норматив един для всех систем водоснабжения.',
    },
    {
        paramCode: 'magnesium',
        nameRu: 'Магний (Mg, суммарно)',
        nameEn: 'Magnesium',
        unit: 'мг/л',
        category: 'inorganic',
        pdk: 50,
        pdkExtended: null,
        pdkSource: 'sanpin_1_2_3685_21',
        hazardClass: 3,
        limitingIndicator: 'organoleptic_taste',
        regulated: true,
        referenceRangeMin: 5,
        referenceRangeMax: 50,
        sanpinSection: 'Раздел III, Таблица 3.13, п. 715',
        notes: 'Помечено <в> (все растворимые формы). Влияет на жёсткость воды совместно с кальцием. Физиологический минимум ~5 мг/л (ВОЗ).',
    },
    {
        paramCode: 'calcium',
        nameRu: 'Кальций (Ca²⁺)',
        nameEn: 'Calcium',
        unit: 'мг/л',
        category: 'inorganic',
        pdk: null,
        pdkExtended: null,
        pdkSource: 'who',
        hazardClass: null,
        limitingIndicator: null,
        regulated: false,
        referenceRangeMin: 25,
        referenceRangeMax: 130,
        sanpinSection: 'Не нормируется отдельно',
        notes: 'СанПиН 1.2.3685-21 не устанавливает ПДК для кальция как отдельного параметра — учитывается через жёсткость общую (hardness_total). Физиологический оптимум ~25-130 мг/л (рекомендации ВОЗ для питьевой воды).',
    },
    {
        paramCode: 'nitrates',
        nameRu: 'Нитраты (NO3⁻)',
        nameEn: 'Nitrates',
        unit: 'мг/л',
        category: 'inorganic',
        pdk: 45,
        pdkExtended: null,
        pdkSource: 'sanpin_1_2_3685_21',
        hazardClass: 3,
        limitingIndicator: 'sanitary_toxicological',
        regulated: true,
        referenceRangeMin: 0,
        referenceRangeMax: 45,
        sanpinSection: 'Раздел III, Таблица 3.13, п. 859',
        notes: 'Помечено <м>. Норматив един для всех систем водоснабжения. NB: 45 мг/л в пересчёте на NO3⁻ (не на N).',
    },
    {
        paramCode: 'nitrites',
        nameRu: 'Нитриты (NO2⁻)',
        nameEn: 'Nitrites',
        unit: 'мг/л',
        category: 'inorganic',
        pdk: 3.0,
        pdkExtended: null,
        pdkSource: 'sanpin_1_2_3685_21',
        hazardClass: 2,
        limitingIndicator: 'sanitary_toxicological',
        regulated: true,
        referenceRangeMin: 0,
        referenceRangeMax: 3.0,
        sanpinSection: 'Раздел III, Таблица 3.13, п. 865',
        notes: 'Помечено <м>. Класс опасности 2 (высокоопасное). NB: в исходном тексте документа — 3.0 мг/л (не 3.3, как в некоторых вторичных источниках).',
    },
    {
        paramCode: 'sulfates',
        nameRu: 'Сульфаты (SO4²⁻)',
        nameEn: 'Sulfates',
        unit: 'мг/л',
        category: 'inorganic',
        pdk: 500,
        pdkExtended: null,
        pdkSource: 'sanpin_1_2_3685_21',
        hazardClass: 4,
        limitingIndicator: 'organoleptic_taste',
        regulated: true,
        referenceRangeMin: 0,
        referenceRangeMax: 500,
        sanpinSection: 'Раздел III, Таблица 3.13, п. 1068',
        notes: 'Помечено <м>.',
    },
    {
        paramCode: 'sulfides',
        nameRu: 'Сульфиды (S²⁻)',
        nameEn: 'Sulfides',
        unit: 'мг/л',
        category: 'inorganic',
        pdk: null,
        pdkExtended: null,
        pdkSource: null,
        hazardClass: null,
        limitingIndicator: null,
        regulated: false,
        referenceRangeMin: 0,
        referenceRangeMax: 0.05,
        sanpinSection: 'Не нормируется отдельно',
        notes: 'СанПиН 1.2.3685-21 не нормирует сульфид-ион (S²⁻) напрямую. Близкие нормируемые параметры: Сероводород H2S (hydrogen_sulfide, 0.05 мг/л) — ПДК п. 1022; Гидросульфид-ион HS⁻ — ПДК 3.0 мг/л, класс 2, с.-т., п. 312. При нейтральном pH сульфидный ион практически переходит в H2S, поэтому для оценки превышения по «сульфидам» в обычной питьевой воде применять норматив сероводорода (0.05 мг/л).',
    },
    {
        paramCode: 'chlorides',
        nameRu: 'Хлориды (Cl⁻)',
        nameEn: 'Chlorides',
        unit: 'мг/л',
        category: 'inorganic',
        pdk: 350,
        pdkExtended: null,
        pdkSource: 'sanpin_1_2_3685_21',
        hazardClass: 4,
        limitingIndicator: 'organoleptic_taste',
        regulated: true,
        referenceRangeMin: 0,
        referenceRangeMax: 350,
        sanpinSection: 'Раздел III, Таблица 3.13, п. 1247',
        notes: 'Помечено <м>.',
    },
    {
        paramCode: 'fluorides',
        nameRu: 'Фториды (F⁻)',
        nameEn: 'Fluorides',
        unit: 'мг/л',
        category: 'inorganic',
        pdk: 1.5,
        pdkExtended: null,
        pdkSource: 'sanpin_1_2_3685_21',
        hazardClass: 2,
        limitingIndicator: 'sanitary_toxicological',
        regulated: true,
        referenceRangeMin: 0.5,
        referenceRangeMax: 1.5,
        sanpinSection: 'Раздел III, Таблица 3.13, п. 1227',
        notes: 'Помечено <м>. Класс опасности 2. Дефицит фтора (<0.5 мг/л) также вреден — приводит к кариесу; ВОЗ рекомендует нижний физиологический минимум ~0.5 мг/л.',
    },
    {
        paramCode: 'hydrogen_sulfide',
        nameRu: 'Сероводород',
        nameEn: 'Hydrogen sulfide',
        unit: 'мг/л',
        category: 'inorganic',
        pdk: 0.05,
        pdkExtended: null,
        pdkSource: 'sanpin_1_2_3685_21',
        hazardClass: 4,
        limitingIndicator: 'organoleptic_smell',
        regulated: true,
        referenceRangeMin: 0,
        referenceRangeMax: 0.05,
        sanpinSection: 'Раздел III, Таблица 3.13, п. 1022',
        notes: 'CAS 7783-06-4, формула H2S. Помечено <м>. NB: в исходном тексте документа — 0.05 мг/л (не 0.003 мг/л, как в некоторых вторичных источниках; 0.003 мг/м³ — это атмосферный норматив, не водный).',
    },
    {
        paramCode: 'alkalinity_total',
        nameRu: 'Щёлочность общая',
        nameEn: 'Total alkalinity',
        unit: 'мг-экв/л',
        category: 'general',
        pdk: null,
        pdkExtended: null,
        pdkSource: 'who',
        hazardClass: null,
        limitingIndicator: null,
        regulated: false,
        referenceRangeMin: 0.5,
        referenceRangeMax: 6.5,
        sanpinSection: 'Не нормируется',
        notes: 'СанПиН 1.2.3685-21 не нормирует щёлочность. Технологический ориентир для питьевой воды — 0.5-6.5 мг-экв/л; влияет на стабильность pH, накипь, эффективность обеззараживания. ВОЗ норматив отсутствует.',
    },

    // ============================================================================
    // ФИЗИЧЕСКИЕ ПОКАЗАТЕЛИ (не нормируются СанПиН для питьевой воды)
    // ============================================================================
    {
        paramCode: 'temperature',
        nameRu: 'Температура',
        nameEn: 'Temperature',
        unit: '°C',
        category: 'physical',
        pdk: null,
        pdkExtended: null,
        pdkSource: 'physiological',
        hazardClass: null,
        limitingIndicator: null,
        regulated: false,
        referenceRangeMin: 5,
        referenceRangeMax: 25,
        sanpinSection: 'Раздел III, Таблица 3.3, п. 10 (только для поверхностных вод)',
        notes: 'СанПиН 1.2.3685-21 не устанавливает абсолютный норматив температуры питьевой воды. Для поверхностных водоисточников ограничение: летняя температура не должна повышаться более чем на 3 °C по сравнению со среднемесячной за последние 10 лет (антропогенный сброс). Физиологически комфортный диапазон 5-25 °C.',
    },
    {
        paramCode: 'electrical_conductivity',
        nameRu: 'Электропроводность',
        nameEn: 'Electrical conductivity',
        unit: 'мкСм/см',
        category: 'physical',
        pdk: null,
        pdkExtended: null,
        pdkSource: 'physiological',
        hazardClass: null,
        limitingIndicator: null,
        regulated: false,
        referenceRangeMin: 100,
        referenceRangeMax: 2000,
        sanpinSection: 'Не нормируется',
        notes: 'СанПиН 1.2.3685-21 не нормирует электропроводность. Косвенный показатель TDS: ~0.65 × EC (мкСм/см) ≈ TDS (мг/л). При TDS=1000 мг/л → EC≈1500 мкСм/см. Используется в лабораторной практике как быстрый индикатор минерализации.',
    },
];

/**
 * Карта синонимов для нормализации названий параметров из реальных бланков
 * (Vision-extract'ы 15 504 анализов воды). Ключ — точный текст из бланка
 * (как пишут лаборатории), значение — каноничный paramCode.
 *
 * Включает OCR-галлюцинации Claude Vision: «Омелeние перманганатная»,
 * «Кислотность перманганатная», «Омега-3», «Магнец» — все мапятся
 * на правильные paramCode'ы.
 */
export const PARAM_SYNONYMS: Record<string, string> = {
    // temperature
    'температура': 'temperature',

    // ph
    'водородный показатель': 'ph',
    'ph': 'ph',
    'рн': 'ph',

    // color
    'цветность': 'color',

    // turbidity
    'мутность': 'turbidity',

    // odor
    'запах': 'odor',
    'запах (при t по п.1)': 'odor',
    'запах при 20°c': 'odor',

    // permanganate_oxidizability — реальные написания и распространённые опечатки.
    // NB: Vision-галлюцинации типа «омега-3», «омелeние», «омнесканность» удалены
    // из синонимов 2026-05-06 — пусть идут в paramsUnknown, не превращаются в число.
    'окисляемость перманганатная': 'permanganate_oxidizability',
    'окисляемость': 'permanganate_oxidizability',
    'перманганатная окисляемость': 'permanganate_oxidizability',
    'оксисляемость': 'permanganate_oxidizability',                    // OCR опечатка
    'оксилемость': 'permanganate_oxidizability',                      // OCR опечатка
    'кислотность перманганатная': 'permanganate_oxidizability',       // «кислотность» как OCR от «окисляемость»

    // tds
    'минерализация (сухой остаток)': 'tds',
    'общая минерализация (сухой остаток)': 'tds',
    'сухой остаток': 'tds',
    'общая минерализация': 'tds',
    'минерализация': 'tds',

    // electrical_conductivity
    'электропроводность': 'electrical_conductivity',
    'удельная электропроводность': 'electrical_conductivity',

    // hardness_total — только общая жёсткость.
    // NB: «постоянная» (без бикарбонатов) и «временная» (бикарбонатная) — это
    // КОМПОНЕНТЫ общей жёсткости, не сама общая. Раньше маппились сюда — фикс
    // 2026-05-06: пусть идут в unknown.
    'жёсткость общая': 'hardness_total',
    'жесткость общая': 'hardness_total',
    'жёсткость': 'hardness_total',
    'жесткость': 'hardness_total',
    'общая жёсткость': 'hardness_total',

    // iron_total
    'железо общее': 'iron_total',
    'железо общее (fe, суммарно)': 'iron_total',
    'железо (fe, суммарно)': 'iron_total',
    'железо суммарное': 'iron_total',
    'железо': 'iron_total',

    // iron_2plus
    'железо двухвалентное': 'iron_2plus',
    'железо двухвалентное (fe²⁺)': 'iron_2plus',
    'железо (ii)': 'iron_2plus',
    'fe2+': 'iron_2plus',

    // manganese — много OCR-вариантов, mapping на каноничный код
    'марганец': 'manganese',
    'марганец (mn, суммарно)': 'manganese',
    'марганец (mn²⁺)': 'manganese',
    'марганец (mn)': 'manganese',
    'марганец (суммарно)': 'manganese',
    'марганец (mn, валентно)': 'manganese',
    'марганец (mn суммарно)': 'manganese',          // без запятой
    'марганец (сумма)': 'manganese',
    'марганец (mn, двухвалентное)': 'manganese',
    'марганец (mn, двухвалентно)': 'manganese',
    'марганец (mn, водорастворимо)': 'manganese',
    'марганец (mn, марганец)': 'manganese',          // Vision склеил
    'марганец (mn, валовано)': 'manganese',          // OCR от «валентно»
    // NB: «Марганец (Mg²⁺)» НЕ синоним manganese — это OCR-ошибка имени.
    // Mg²⁺ = ион магния. Реальное название в бланке — «Магний (Mg²⁺)».
    // Vision спутал «Магний» → «Марганец» по форме букв, но формула Mg²⁺
    // химически корректна → маппим в magnesium ниже (не manganese).

    // magnesium
    'магний': 'magnesium',
    'магний (mg²⁺)': 'magnesium',
    'магний (mg, суммарно)': 'magnesium',
    'магний (mg)': 'magnesium',
    // OCR-ошибка имени «Магний» → «Марганец», но формула Mg²⁺ корректна → магний.
    // 658 записей в dataset (изначально неверно смаппил в manganese, fix 2026-05-06).
    'марганец (mg²⁺)': 'magnesium',
    'магнец (mg²⁺)': 'magnesium', // OCR

    // calcium
    'кальций': 'calcium',
    'кальций (ca²⁺)': 'calcium',

    // nitrates
    'нитраты': 'nitrates',
    'нитраты (no₃⁻)': 'nitrates',
    'нитраты (no3-)': 'nitrates',

    // nitrites
    'нитриты': 'nitrites',
    'нитриты (no₂⁻)': 'nitrites',
    'нитриты (no2-)': 'nitrites',

    // sulfates
    'сульфаты': 'sulfates',
    'сульфаты (so₄²⁻)': 'sulfates',
    'сульфаты (so42-)': 'sulfates',

    // sulfides
    'сульфиды': 'sulfides',
    'сульфиды (s²⁻)': 'sulfides',
    'сульфиды (s2-)': 'sulfides',

    // chlorides
    'хлориды': 'chlorides',
    'хлориды (cl⁻)': 'chlorides',
    'хлориды (cl-)': 'chlorides',

    // fluorides
    'фториды': 'fluorides',
    'фториды (f⁻)': 'fluorides',
    'фториды (f-)': 'fluorides',

    // hydrogen_sulfide
    'сероводород': 'hydrogen_sulfide',
    'сероводород (h₂s)': 'hydrogen_sulfide',
    'сероводород (h2s)': 'hydrogen_sulfide',

    // alkalinity_total — щёлочность.
    // NB: «щёлочность перманганатная» (OCR-склейка «Щёлочность общая» + «Окисляемость
    // перманганатная») удалена из синонимов 2026-05-06 — невозможно различить
    // что Vision реально читал, пусть идёт в unknown.
    'щёлочность общая': 'alkalinity_total',
    'щелочность общая': 'alkalinity_total',
    'щёлочность': 'alkalinity_total',
    'щелочность': 'alkalinity_total',

    // ammonium
    'аммиак': 'ammonium',
    'аммиак / аммоний-ион': 'ammonium',
    'ион аммония': 'ammonium',
    'аммоний': 'ammonium',
    'аммоний (nh₄⁺)': 'ammonium',
    'аммоний (nh4+)': 'ammonium',
};

/**
 * Быстрый lookup-индекс по paramCode.
 */
export const WATER_PARAMS_BY_CODE: Record<string, TWaterParam> = WATER_PARAMS.reduce(
    (acc, param) => {
        acc[param.paramCode] = param;
        return acc;
    },
    {} as Record<string, TWaterParam>,
);

/**
 * Возвращает каноническую единицу измерения для paramCode.
 *
 * Стратегия чтения unit'а из derived `WaterAnalysis`:
 *   - 95% случаев unit совпадает с canonical (из справочника СанПиН) — paramUnits НЕ хранит, экономит место
 *   - Редкие случаи (turbidity мг/л-каолин ≈ 82 записи на 15 504) — paramUnits хранит override
 *
 * Будущее: при переходе на sparse-модель paramUnits (хранить только overrides)
 * этот helper читает override → fallback на canonical из справочника.
 *
 * @param paramCode — канонический код параметра (iron_total, hardness_total, etc.)
 * @param paramUnits — derived `WaterAnalysis.paramUnits` (sparse или full — оба работают)
 * @returns единица или `null` если paramCode unknown
 */
export function getParamUnit(paramCode: string, paramUnits: Record<string, string> | null | undefined): string | null {
    if (paramUnits && paramUnits[paramCode] !== undefined) {
        return paramUnits[paramCode];
    }
    return WATER_PARAMS_BY_CODE[paramCode]?.unit ?? null;
}

/**
 * Утилита: вычисляет признак превышения ПДК для заданного значения.
 * Возвращает `null` если параметр не нормируется.
 */
export function exceedsPdk(paramCode: string, value: number): boolean | null {
    const param = WATER_PARAMS_BY_CODE[paramCode];
    if (!param || !param.regulated || param.pdk === null) return null;

    if (typeof param.pdk === 'number') {
        return value > param.pdk;
    }
    // Range-type ПДК (например, pH): вне диапазона — превышение.
    return value < param.pdk.min || value > param.pdk.max;
}
