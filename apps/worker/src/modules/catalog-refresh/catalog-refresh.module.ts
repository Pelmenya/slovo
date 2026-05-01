import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { FlowiseClient, type TFlowiseClientConfig } from '@slovo/flowise-client';
import type { TAppEnv } from '@slovo/common';
import { FLOWISE_CLIENT_TOKEN, REDIS_CLIENT_TOKEN } from './catalog-refresh.constants';
import { CatalogRefreshService } from './catalog-refresh.service';

// Defensive guard для useFactory — env.schema.ts уже валидирует
// FLOWISE_API_KEY условно (когда FLOWISE_API_URL задан в production), но в
// dev FLOWISE_API_URL может быть optional. Этот throw гарантирует что service
// не стартует с garbage config — fail-fast при некорректной конфигурации worker'а.
function assertEnv(value: string | undefined, name: string): string {
    if (!value) {
        throw new Error(`${name} is required for catalog-refresh worker`);
    }
    return value;
}

@Module({
    providers: [
        CatalogRefreshService,
        {
            provide: FLOWISE_CLIENT_TOKEN,
            useFactory: (config: ConfigService<TAppEnv>): FlowiseClient => {
                const clientConfig: TFlowiseClientConfig = {
                    apiUrl: assertEnv(config.get('FLOWISE_API_URL', { infer: true }), 'FLOWISE_API_URL'),
                    apiKey: assertEnv(config.get('FLOWISE_API_KEY', { infer: true }), 'FLOWISE_API_KEY'),
                };
                return new FlowiseClient(clientConfig);
            },
            inject: [ConfigService],
        },
        {
            provide: REDIS_CLIENT_TOKEN,
            useFactory: (config: ConfigService<TAppEnv>): Redis => {
                const host = assertEnv(config.get('REDIS_HOST', { infer: true }), 'REDIS_HOST');
                const port = config.get('REDIS_PORT', { infer: true });
                if (!port) {
                    throw new Error('REDIS_PORT is required for catalog-refresh worker');
                }
                const password = config.get('REDIS_PASSWORD', { infer: true });
                return new Redis({
                    host,
                    port,
                    password: password || undefined,
                    lazyConnect: false,
                    maxRetriesPerRequest: 3,
                });
            },
            inject: [ConfigService],
        },
    ],
})
export class CatalogRefreshModule {}
