// =============================================================================
// Constants для water-analysis-домена — единый source-of-truth для модулей
// которые работают с водными анализами (apps/api/water-analysis сейчас, в
// будущем — equipment-matcher / prostor-app виджет / CRM-aqua dashboard).
//
// Канонический источник здесь, локальные re-export'ы. Иначе при ребрендинге
// store / переезде на multi-tenant имена разойдутся между модулями и
// vector-search будет тихо ломаться.
//
// TODO(multi-tenant): когда появятся пользователи — заменить на per-tenant
// маппинг через Prisma TenantConfig (как для catalog).
// =============================================================================

export const WATER_ANALYSIS_AQUAPHOR_STORE_NAME = 'water-analysis-aquaphor';
