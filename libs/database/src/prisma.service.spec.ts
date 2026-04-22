import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '@slovo/common';
import { PrismaService } from './prisma.service';

type TestConfigService = ConfigService<AppEnv, true>;

jest.mock('@prisma/client', () => {
    class MockPrismaClient {
        $connect = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
        $disconnect = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
        constructor(public options?: unknown) {}
    }
    return { PrismaClient: MockPrismaClient };
});

jest.mock('@prisma/adapter-pg', () => ({
    PrismaPg: jest.fn().mockImplementation((opts: unknown) => ({ opts })),
}));

function makeConfig(partial: Partial<Record<'DATABASE_URL' | 'NODE_ENV', string>>): TestConfigService {
    const store: Record<string, unknown> = { ...partial };
    return {
        getOrThrow: jest.fn((key: string) => {
            if (!(key in store)) {
                throw new Error(`${key} not set`);
            }
            return store[key];
        }),
        get: jest.fn((key: string) => store[key]),
    } as unknown as TestConfigService;
}

describe('PrismaService', () => {
    const VALID_URL = 'postgresql://u:p@localhost:5433/db';

    describe('конструктор: валидация DATABASE_URL', () => {
        it('принимает postgresql://', () => {
            const config = makeConfig({ DATABASE_URL: VALID_URL });
            expect(() => new PrismaService(config)).not.toThrow();
        });

        it('принимает postgres://', () => {
            const config = makeConfig({ DATABASE_URL: 'postgres://u:p@localhost/db' });
            expect(() => new PrismaService(config)).not.toThrow();
        });

        it('бросает на mysql://', () => {
            const config = makeConfig({ DATABASE_URL: 'mysql://u:p@localhost/db' });
            expect(() => new PrismaService(config)).toThrow(/postgres:\/\/ или postgresql:\/\//);
        });

        it('бросает на http://', () => {
            const config = makeConfig({ DATABASE_URL: 'http://localhost/db' });
            expect(() => new PrismaService(config)).toThrow(/postgres:\/\//);
        });

        it('бросает на строке без протокола', () => {
            const config = makeConfig({ DATABASE_URL: 'localhost:5432/db' });
            expect(() => new PrismaService(config)).toThrow(/невалиден как URL|postgres:\/\//);
        });

        it('бросает на пустой строке (getOrThrow)', () => {
            const config = makeConfig({});
            expect(() => new PrismaService(config)).toThrow(/DATABASE_URL not set/);
        });

        it('бросает на URL без hostname', () => {
            const config = makeConfig({ DATABASE_URL: 'postgresql:///db' });
            expect(() => new PrismaService(config)).toThrow(/hostname|postgres:\/\//);
        });
    });

    describe('выбор log-уровней по NODE_ENV', () => {
        it('в development логирует query+warn+error', () => {
            const config = makeConfig({ DATABASE_URL: VALID_URL, NODE_ENV: 'development' });
            const service = new PrismaService(config);
            const options = (service as unknown as { options: { log: string[] } }).options;
            expect(options.log).toEqual(['query', 'warn', 'error']);
        });

        it('в production логирует только warn+error', () => {
            const config = makeConfig({ DATABASE_URL: VALID_URL, NODE_ENV: 'production' });
            const service = new PrismaService(config);
            const options = (service as unknown as { options: { log: string[] } }).options;
            expect(options.log).toEqual(['warn', 'error']);
        });
    });

    describe('lifecycle', () => {
        it('onModuleInit: успешный $connect логируется', async () => {
            const config = makeConfig({ DATABASE_URL: VALID_URL });
            const service = new PrismaService(config);
            const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

            await service.onModuleInit();

            expect(service.$connect).toHaveBeenCalledTimes(1);
            expect(logSpy).toHaveBeenCalledWith('Prisma connected to database');
            logSpy.mockRestore();
        });

        it('onModuleInit: ошибка $connect логируется error и re-throw', async () => {
            const config = makeConfig({ DATABASE_URL: VALID_URL });
            const service = new PrismaService(config);
            const boom = new Error('connection refused');
            jest.spyOn(service, '$connect').mockRejectedValueOnce(boom);
            const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

            await expect(service.onModuleInit()).rejects.toThrow('connection refused');
            expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('connection refused'));
            errSpy.mockRestore();
        });

        it('onModuleDestroy: вызывает $disconnect и логирует', async () => {
            const config = makeConfig({ DATABASE_URL: VALID_URL });
            const service = new PrismaService(config);
            const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

            await service.onModuleDestroy();

            expect(service.$disconnect).toHaveBeenCalledTimes(1);
            expect(logSpy).toHaveBeenCalledWith('Prisma disconnected from database');
            logSpy.mockRestore();
        });
    });
});
