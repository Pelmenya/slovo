// Контекст пользователя в запросе. Заготовка под JWT: когда появится auth,
// anonymous-ветка исчезнет из большинства controller'ов, останется только
// для специальных public endpoints. Сейчас — Phase 1 заглушка: header ИЛИ
// аноним. Service-слой работает с этим типом вместо `string | null`, чтобы
// при миграции на JWT не рефакторить все сигнатуры.

export type TUserContext =
    | { readonly userId: string }
    | { readonly anonymous: true };

export function isAnonymous(ctx: TUserContext): ctx is { readonly anonymous: true } {
    return 'anonymous' in ctx;
}

// Утилита для Prisma ownership-filter. null = anonymous (ищем orphan-записи).
export function userIdOrNull(ctx: TUserContext): string | null {
    if ('userId' in ctx) {
        return ctx.userId;
    }
    return null;
}
