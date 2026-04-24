import { BadRequestException, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { USER_ID_HEADER } from './headers';
import type { TUserContext } from './t-user-context';

// UUIDv4 regex (те же правила, что у ParseUUIDPipe({ version: '4' })).
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Декоратор читает X-User-Id header, валидирует UUIDv4 и возвращает TUserContext.
// Если header отсутствует — { anonymous: true }.
// Если header не UUID — 400 BadRequestException (не 500 от Prisma дальше по стеку).
//
// Должен использоваться только под DevOnlyHeaderAuthGuard — иначе в prod
// сработает spoofing. См. libs/common/src/http/dev-only-header-auth.guard.ts.
export const UserContext = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): TUserContext => {
        const request = ctx.switchToHttp().getRequest<Request>();
        const raw = request.headers[USER_ID_HEADER];
        if (raw === undefined || raw === '') {
            return { anonymous: true };
        }
        // Express нормализует header keys в lowercase; значение — string | string[].
        // Берём первый если массив (HTTP допускает повтор header'а, но для нас
        // смысла нет — ожидаем один userId).
        const value = Array.isArray(raw) ? raw[0] : raw;
        if (typeof value !== 'string' || !UUID_V4.test(value)) {
            throw new BadRequestException(
                `${USER_ID_HEADER} must be a valid UUIDv4`,
            );
        }
        return { userId: value.toLowerCase() };
    },
);
