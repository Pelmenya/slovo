// Унифицированный intake-type filter для drilling-endpoints.
//
// Используется в /depth-map, /depth-predict, /aquifer-stats — все три фильтруют
// по типу источника воды на стороне SQL и принимают одинаковый набор literal'ов.
//
// Раньше было 2 дубликата (DEPTH_MAP_INTAKE_FILTER + DEPTH_PREDICT_INTAKE_FILTER)
// + aquifer-stats импортил TDepthMapIntakeFilter из чужого namespace
// (architect-reviewer + nestjs-code-reviewer flagged 2026-05-08).
//
// `well_dug` — копаный колодец (мелкий, в МО типично 5-15м). `well` — бурёная
// скважина. `all` — оба типа (municipal/spring/river depth не имеет смысла).

export const INTAKE_TYPE_FILTER_VALUES = ['all', 'well', 'well_dug'] as const;
export type TIntakeTypeFilter = (typeof INTAKE_TYPE_FILTER_VALUES)[number];
