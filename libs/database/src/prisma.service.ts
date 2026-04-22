import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PrismaService.name);

    constructor(config: ConfigService) {
        const connectionString = config.getOrThrow<string>('DATABASE_URL');
        if (!/^postgres(ql)?:\/\//.test(connectionString)) {
            throw new Error('DATABASE_URL must start with postgres:// or postgresql://');
        }
        super({
            adapter: new PrismaPg({ connectionString }),
        });
    }

    async onModuleInit() {
        try {
            await this.$connect();
            this.logger.log('Prisma connected to database');
        } catch (err) {
            this.logger.error(`Failed to connect to Postgres: ${(err as Error).message}`);
            throw err;
        }
    }

    async onModuleDestroy() {
        await this.$disconnect();
        this.logger.log('Prisma disconnected from database');
    }
}
