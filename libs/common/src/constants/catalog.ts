// =============================================================================
// Constants для catalog-домена — единый source-of-truth для всех модулей
// которые работают с каталогом Аквафор (apps/api/catalog, apps/worker/
// catalog-refresh, в будущем — потенциальные новые consumer'ы).
//
// Раньше эти константы дублировались между api и worker — drift риск
// (один поправит при ребрендинге, другой нет → search/refresh ломаются
// тихо). Канонический источник здесь, локальные re-export'ы.
//
// TODO(multi-tenant): когда появятся пользователи — заменить на per-tenant
// маппинг через Prisma TenantConfig.
// =============================================================================

export const CATALOG_AQUAPHOR_STORE_NAME = 'catalog-aquaphor';

// Имя Flowise chatflow для vision-describer (Claude Vision → JSON описание
// товара). Создан в Phase 0 (lab journal day 1, validated на 6 фото).
// Используется apps/api/catalog/search/image. В Phase 2 backlog
// (vision-catalog-search.md) — batch image processing в worker, тогда
// shared контант предотвратит drift.
export const VISION_CATALOG_DESCRIBER_CHATFLOW_NAME = 'vision-catalog-describer-v1';
