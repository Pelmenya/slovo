// =============================================================================
// Constants для catalog-домена — единый source-of-truth для всех модулей
// которые работают с каталогом Аквафор (apps/api/catalog, apps/worker/
// catalog-refresh, в будущем — потенциальные новые consumer'ы).
//
// Раньше эта строка дублировалась в `apps/api/.../catalog.constants.ts` и
// `apps/worker/.../catalog-refresh.constants.ts` — drift риск (один поправит
// при ребрендинге, другой нет → search ломается тихо).
//
// TODO(multi-tenant): когда появятся пользователи — заменить на per-tenant
// store name через Prisma TenantConfig (user.tenantId → storeName).
// =============================================================================

export const CATALOG_AQUAPHOR_STORE_NAME = 'catalog-aquaphor';
