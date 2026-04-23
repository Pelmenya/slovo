import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { TAppEnv } from '@slovo/common';

const ALLOWED_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

function assertValidPostgresUrl(raw: string): void {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error('DATABASE_URL невалиден как URL');
    }
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
        throw new Error(`DATABASE_URL должен иметь протокол postgres:// или postgresql://, получено ${url.protocol}`);
    }
    if (!url.hostname) {
        throw new Error('DATABASE_URL должен содержать hostname');
    }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PrismaService.name);

    constructor(config: ConfigService<TAppEnv, true>) {
        const connectionString = config.getOrThrow('DATABASE_URL', { infer: true });
        assertValidPostgresUrl(connectionString);
        const isDev = config.get('NODE_ENV', { infer: true }) === 'development';
        super({
            adapter: new PrismaPg({ connectionString }),
            log: isDev ? ['query', 'warn', 'error'] : ['warn', 'error'],
        });
    }

    async onModuleInit() {
        try {
            await this.$connect();
            this.logger.log('Prisma connected to database');
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(`Failed to connect to Postgres: ${message}`);
            throw err;
        }
    }

    async onModuleDestroy() {
        await this.$disconnect();
        this.logger.log('Prisma disconnected from database');
    }
}
