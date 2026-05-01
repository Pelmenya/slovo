import { Global, Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TAppEnv } from '@slovo/common';
import Redis from 'ioredis';
import { BUDGET_REDIS_TOKEN } from './budget.constants';
import { BudgetService } from './budget.service';

// @Global() — Budget cap это cross-cutting concern: и catalog/search, и
// будущие knowledge AI-фичи (Q&A endpoints) должны hit'ить тот же cap.
// Альтернатива (не-Global) требовала бы импортить BudgetModule в каждый
// feature module — добавляет шум без пользы.
//
// Worker (apps/worker) НЕ использует BudgetService — refresh идёт раз в
// 4ч и стоит копейки (per ingest ~250K tokens × $0.02/1M = $0.005),
// budget cap там overkill.

const budgetRedisProvider: Provider = {
    provide: BUDGET_REDIS_TOKEN,
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
            maxRetriesPerRequest: 3,
            connectTimeout: 5_000,
            // Budget commands должны быть быстрыми — INCR/GET ≤1ms typically.
            // 2s ceiling ловит slowlog events.
            commandTimeout: 2_000,
        });
    },
};

@Global()
@Module({
    providers: [budgetRedisProvider, BudgetService],
    exports: [BudgetService],
})
export class BudgetModule {}
