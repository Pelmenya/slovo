// HTTP-заголовки, которые читает / выдаёт приложение.
// Одно место — единый источник правды, чтобы не плодить magic strings.

// Phase 1 auth-заглушка. FIXME: удалить одновременно с вводом JWT guard
// (будет в отдельном PR auth) — иначе spoofing остаётся production risk.
// См. DevOnlyHeaderAuthGuard и TUserContext.
export const USER_ID_HEADER = 'x-user-id';
