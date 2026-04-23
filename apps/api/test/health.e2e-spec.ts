import type { Server } from 'http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from '@slovo/database';
import request from 'supertest';
import { HealthModule } from '../src/modules/health/health.module';

type THealthResponse = {
    status: string;
    service: string;
    timestamp: string;
};

type TReadinessResponse = {
    status: 'ok' | 'degraded';
    checks: { db: boolean };
    timestamp: string;
    message?: string;
};

describe('Health endpoints (e2e)', () => {
    let app: INestApplication;
    let server: Server;
    let prismaMock: { $queryRaw: jest.Mock };

    beforeAll(async () => {
        prismaMock = {
            $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
        };
        const moduleRef: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
                ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }]),
                HealthModule,
            ],
        })
            .overrideProvider(PrismaService)
            .useValue(prismaMock)
            .compile();

        app = moduleRef.createNestApplication();
        app.useGlobalPipes(
            new ValidationPipe({
                whitelist: true,
                forbidNonWhitelisted: true,
                transform: true,
                transformOptions: { enableImplicitConversion: true },
            }),
        );
        await app.init();
        server = app.getHttpServer() as Server;
    });

    afterAll(async () => {
        await app.close();
    });

    describe('GET /health (liveness)', () => {
        it('возвращает 200 с корректной структурой', async () => {
            const response = await request(server).get('/health').expect(200);
            const body = response.body as unknown as THealthResponse;

            expect(body.status).toBe('ok');
            expect(body.service).toBe('slovo-api');
            expect(typeof body.timestamp).toBe('string');
            expect(Date.parse(body.timestamp)).not.toBeNaN();
        });
    });

    describe('GET /health/ready (readiness)', () => {
        beforeEach(() => {
            prismaMock.$queryRaw.mockReset();
        });

        it('возвращает 200 и checks.db=true когда БД отвечает', async () => {
            prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

            const response = await request(server).get('/health/ready').expect(200);
            const body = response.body as unknown as TReadinessResponse;

            expect(body.status).toBe('ok');
            expect(body.checks.db).toBe(true);
            expect(typeof body.timestamp).toBe('string');
            expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
        });

        it('возвращает 503 и checks.db=false когда БД не отвечает', async () => {
            prismaMock.$queryRaw.mockRejectedValue(new Error('ECONNREFUSED'));

            const response = await request(server).get('/health/ready').expect(503);
            const body = response.body as unknown as TReadinessResponse;

            expect(body.status).toBe('degraded');
            expect(body.checks.db).toBe(false);
        });
    });
});
