import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { createAppConfigModule, createAppLoggerModule } from '@slovo/common';
import type { AppEnv } from '@slovo/common';
import { HealthModule } from './modules/health/health.module';

@Module({
    imports: [
        createAppConfigModule(),
        createAppLoggerModule(),
        ThrottlerModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService<AppEnv, true>) => [
                {
                    ttl: config.get('THROTTLE_TTL', { infer: true }) * 1000,
                    limit: config.get('THROTTLE_LIMIT', { infer: true }),
                },
            ],
        }),
        HealthModule,
    ],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
