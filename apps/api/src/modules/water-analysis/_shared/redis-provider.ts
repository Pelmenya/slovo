import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TAppEnv } from '@slovo/common';
import Redis from 'ioredis';

// =============================================================================
// Shared Redis provider factory. Дублировался ×7 (heatmap, predict, depth-map,
// depth-predict, points, equipment-suggest, aquifer-stats) — ~150 LOC копипасты
// при идентичных настройках (host/port/password/maxRetriesPerRequest=2/
// connectTimeout=5_000/commandTimeout=3_000).
//
// Per-feature observability аргумент (отдельные Redis instance per endpoint)
// не работает: ioredis шарит TCP под капотом для одного host:port. Отдельные
// `new Redis()` создают разные client-side metric counters, но не isolation.
//
// Если в будущем потребуется разная конфигурация (например slowlog-routing,
// cluster mode, разные read replicas) — extract per-call параметры. Сейчас
// все 7 endpoints одинаковые → один factory.
// =============================================================================

export function createWaterAnalysisRedisProvider(token: symbol): Provider {
    return {
        provide: token,
        inject: [ConfigService],
        useFactory: (config: ConfigService<TAppEnv, true>): Redis => {
            const host = config.getOrThrow('REDIS_HOST', { infer: true });
            const port = config.getOrThrow('REDIS_PORT', { infer: true });
            const password = config.get('REDIS_PASSWORD', { infer: true });
            return new Redis({
                host,
                port,
                password: password || undefined,
                lazyConnect: false,
                maxRetriesPerRequest: 2,
                connectTimeout: 5_000,
                commandTimeout: 3_000,
            });
        },
    };
}
