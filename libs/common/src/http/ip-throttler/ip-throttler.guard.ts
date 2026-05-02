import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { extractIpTracker } from './extract-ip-tracker';

// =============================================================================
// IpThrottlerGuard — кастомный throttler с IPv6-/64-aware tracker (#65 /
// pre-launch blocker A).
//
// Дефолтный ThrottlerGuard использует req.ip как tracker — это ломает per-IP
// throttle для IPv6-клиентов: один провайдер выдаёт `2^64` адресов одному
// физическому клиенту, бот тривиально rotate'ит IPv6 → 30 × 2^64 запросов
// в минуту = бесконечность.
//
// `extractIpTracker` извлекает /64-prefix для IPv6, для IPv4 оставляет как
// есть. IPv4-mapped IPv6 (`::ffff:x.x.x.x`) нормализуется до IPv4.
//
// Применяется глобально через APP_GUARD в app.module.ts. На отдельных
// endpoint'ах кастомные лимиты ставятся через @Throttle({...}) decorator.
// =============================================================================

@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
    // Override базовой реализации (которая просто `return req.ip`).
    // Express req.ip приходит после `app.set('trust proxy', N)` middleware
    // (см. apps/api/src/main.ts + TRUSTED_PROXY_HOPS env). Без trust proxy
    // в production все IP'шки = nginx-pod, throttle обнуляется.
    //
    // extractIpTracker принимает unknown — narrow внутри.
    protected getTracker(req: Record<string, unknown>): Promise<string> {
        return Promise.resolve(extractIpTracker(req.ip));
    }
}
