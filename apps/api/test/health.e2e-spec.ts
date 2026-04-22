import type { Server } from 'http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { HealthModule } from '../src/modules/health/health.module';

interface HealthResponse {
    status: string;
    service: string;
    timestamp: string;
}

describe('GET /health (e2e)', () => {
    let app: INestApplication;
    let server: Server;

    beforeAll(async () => {
        const moduleRef: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
                ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }]),
                HealthModule,
            ],
        }).compile();

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

    it('возвращает 200 с корректной структурой', async () => {
        const response = await request(server).get('/health').expect(200);
        const body = response.body as unknown as HealthResponse;

        expect(body.status).toBe('ok');
        expect(body.service).toBe('slovo-api');
        expect(typeof body.timestamp).toBe('string');
        expect(Date.parse(body.timestamp)).not.toBeNaN();
    });

    it('timestamp — свежий (в пределах 5 секунд)', async () => {
        const before = Date.now();
        const response = await request(server).get('/health').expect(200);
        const after = Date.now();
        const body = response.body as unknown as HealthResponse;

        const ts = Date.parse(body.timestamp);
        expect(ts).toBeGreaterThanOrEqual(before - 1000);
        expect(ts).toBeLessThanOrEqual(after + 1000);
    });
});
