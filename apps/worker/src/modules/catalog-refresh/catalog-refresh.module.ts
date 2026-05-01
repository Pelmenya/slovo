import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { FlowiseClient, type TFlowiseClientConfig } from '@slovo/flowise-client';
import type { TAppEnv } from '@slovo/common';
import {
    CatalogRefreshService,
    FLOWISE_CLIENT_TOKEN,
    REDIS_CLIENT_TOKEN,
} from './catalog-refresh.service';

@Module({
    providers: [
        CatalogRefreshService,
        {
            provide: FLOWISE_CLIENT_TOKEN,
            useFactory: (config: ConfigService<TAppEnv>): FlowiseClient => {
                const apiUrl = config.get('FLOWISE_API_URL', { infer: true });
                const apiKey = config.get('FLOWISE_API_KEY', { infer: true });
                if (!apiUrl) {
                    throw new Error('FLOWISE_API_URL is required for catalog-refresh');
                }
                if (!apiKey) {
                    throw new Error('FLOWISE_API_KEY is required for catalog-refresh');
                }
                const clientConfig: TFlowiseClientConfig = { apiUrl, apiKey };
                return new FlowiseClient(clientConfig);
            },
            inject: [ConfigService],
        },
        {
            provide: REDIS_CLIENT_TOKEN,
            useFactory: (config: ConfigService<TAppEnv>): Redis => {
                const host = config.get('REDIS_HOST', { infer: true });
                const port = config.get('REDIS_PORT', { infer: true });
                const password = config.get('REDIS_PASSWORD', { infer: true });
                if (!host || !port) {
                    throw new Error('REDIS_HOST and REDIS_PORT are required for catalog-refresh');
                }
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
