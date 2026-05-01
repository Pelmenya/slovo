import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { createAppConfigModule, createAppLoggerModule } from '@slovo/common';
import type { TAppEnv } from '@slovo/common';
import { BudgetModule } from './modules/budget/budget.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { HealthModule } from './modules/health/health.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';

@Module({
    imports: [
        createAppConfigModule(),
        createAppLoggerModule(),
        ThrottlerModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService<TAppEnv, true>) => [
                {
                    ttl: config.get('THROTTLE_TTL', { infer: true }) * 1000,
                    limit: config.get('THROTTLE_LIMIT', { infer: true }),
                },
            ],
        }),
        // BudgetModule @Global() — DI'ит BudgetService в любой feature
        // module без явного import. См. tech-debt #21.
        BudgetModule,
        HealthModule,
        KnowledgeModule,
        CatalogModule,
    ],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
