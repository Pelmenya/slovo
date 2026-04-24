// e2e smoke для /knowledge/sources/* — полный цикл create→get→list→delete
// против ЖИВОЙ Postgres. Почему не моки:
//  - в list() есть prisma.$transaction([findMany, count]) — моки его не проверяют
//  - на таблице висят CHECK-constraints (payload_exclusive, progress 0..100) —
//    они срабатывают только на реальной БД
//  - ownership filter (userId IS NULL vs userId=X) важно проверить на SQL-уровне
// Требования: docker-compose.infra.yml up (postgres), миграции применены.

import type { Server } from 'http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { createAppConfigModule } from '@slovo/common';
import { PrismaService } from '@slovo/database';
import request from 'supertest';
import { KnowledgeModule } from '../src/modules/knowledge/knowledge.module';

type TResponseSource = {
    id: string;
    userId: string | null;
    sourceType: string;
    status: string;
    progress: number;
    title: string | null;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    completedAt: string | null;
};

type TPaginatedResponse = {
    items: TResponseSource[];
    total: number;
    page: number;
    limit: number;
};

const TEST_TITLE_PREFIX = 'e2e-test-knowledge-';

describe('Knowledge endpoints (e2e)', () => {
    let app: INestApplication;
    let server: Server;
    let prisma: PrismaService;

    beforeAll(async () => {
        const moduleRef: TestingModule = await Test.createTestingModule({
            imports: [
                createAppConfigModule(),
                ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10_000 }]),
                KnowledgeModule,
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
        prisma = app.get(PrismaService);
    });

    afterAll(async () => {
        await cleanup(prisma);
        await app.close();
    });

    beforeEach(async () => {
        await cleanup(prisma);
    });

    describe('POST /knowledge/sources/text', () => {
        it('создаёт источник и возвращает 201 с response DTO', async () => {
            const response = await request(server)
                .post('/knowledge/sources/text')
                .send({
                    title: `${TEST_TITLE_PREFIX}alpha`,
                    rawText: 'ingestion payload для проверки',
                })
                .expect(201);

            const body = response.body as TResponseSource;
            expect(body.id).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
            );
            expect(body.sourceType).toBe('text');
            expect(body.status).toBe('ready');
            expect(body.progress).toBe(100);
            expect(body.title).toBe(`${TEST_TITLE_PREFIX}alpha`);
            expect(body.userId).toBeNull();
            // rawText НЕ в response (internal)
            expect(body).not.toHaveProperty('rawText');
            expect(body).not.toHaveProperty('extractedText');
            expect(body).not.toHaveProperty('storageKey');
            expect(body).not.toHaveProperty('error');
        });

        it('400 если rawText отсутствует (ValidationPipe)', async () => {
            await request(server)
                .post('/knowledge/sources/text')
                .send({ title: `${TEST_TITLE_PREFIX}no-text` })
                .expect(400);
        });

        it('400 если rawText пустая строка', async () => {
            await request(server)
                .post('/knowledge/sources/text')
                .send({ rawText: '' })
                .expect(400);
        });

        it('400 если в body левые поля (forbidNonWhitelisted)', async () => {
            await request(server)
                .post('/knowledge/sources/text')
                .send({
                    rawText: 'ok',
                    userId: '00000000-0000-0000-0000-000000000001',
                    sourceType: 'video',
                })
                .expect(400);
        });

        it('title опционален', async () => {
            const response = await request(server)
                .post('/knowledge/sources/text')
                .send({ rawText: 'без заголовка' })
                .expect(201);

            const body = response.body as TResponseSource;
            expect(body.title).toBeNull();
        });
    });

    describe('GET /knowledge/sources/:id', () => {
        it('возвращает созданный источник', async () => {
            const created = await createSource('получение');
            const response = await request(server)
                .get(`/knowledge/sources/${created.id}`)
                .expect(200);
            const body = response.body as TResponseSource;
            expect(body.id).toBe(created.id);
            expect(body.title).toBe(created.title);
        });

        it('404 если id не найден', async () => {
            await request(server)
                .get('/knowledge/sources/11111111-1111-4111-8111-111111111111')
                .expect(404);
        });

        it('400 если id не UUID (ParseUUIDPipe)', async () => {
            await request(server).get('/knowledge/sources/not-a-uuid').expect(400);
        });

        it('аноним не видит источник с userId (ownership)', async () => {
            const userId = '11111111-1111-4111-8111-111111111199';
            const created = await createSource('owned', userId);
            // Без X-User-Id — anonymous → не видит owned источник
            await request(server).get(`/knowledge/sources/${created.id}`).expect(404);
            // С правильным X-User-Id — видит
            await request(server)
                .get(`/knowledge/sources/${created.id}`)
                .set('X-User-Id', userId)
                .expect(200);
        });
    });

    describe('GET /knowledge/sources (list)', () => {
        it('возвращает paginated список', async () => {
            await createSource('list-1');
            await createSource('list-2');
            await createSource('list-3');

            const response = await request(server).get('/knowledge/sources').expect(200);
            const body = response.body as TPaginatedResponse;

            expect(body.total).toBe(3);
            expect(body.items).toHaveLength(3);
            expect(body.page).toBe(1);
            expect(body.limit).toBe(20);
            // sort по createdAt desc → самый свежий первым
            expect(body.items[0].title).toBe(`${TEST_TITLE_PREFIX}list-3`);
        });

        it('применяет limit и page', async () => {
            await createSource('p1');
            await createSource('p2');
            await createSource('p3');

            const response = await request(server)
                .get('/knowledge/sources?page=2&limit=1')
                .expect(200);
            const body = response.body as TPaginatedResponse;
            expect(body.total).toBe(3);
            expect(body.items).toHaveLength(1);
            expect(body.page).toBe(2);
            expect(body.limit).toBe(1);
        });

        it('фильтрует по status', async () => {
            await createSource('ready-1');
            // Все text-источники имеют status=ready (Phase 1 синхронный)
            const response = await request(server)
                .get('/knowledge/sources?status=ready')
                .expect(200);
            expect((response.body as TPaginatedResponse).total).toBeGreaterThanOrEqual(1);

            const emptyResponse = await request(server)
                .get('/knowledge/sources?status=failed')
                .expect(200);
            expect((emptyResponse.body as TPaginatedResponse).total).toBe(0);
        });

        it('400 при невалидных query params', async () => {
            await request(server).get('/knowledge/sources?limit=999').expect(400);
            await request(server).get('/knowledge/sources?page=0').expect(400);
            await request(server).get('/knowledge/sources?limit=abc').expect(400);
        });

        it('400 если X-User-Id невалидный UUID', async () => {
            await request(server)
                .get('/knowledge/sources')
                .set('X-User-Id', 'not-a-uuid')
                .expect(400);
            await request(server)
                .get('/knowledge/sources')
                .set('X-User-Id', 'admin')
                .expect(400);
        });
    });

    describe('DELETE /knowledge/sources/:id', () => {
        it('удаляет и возвращает 204', async () => {
            const created = await createSource('to-delete');
            await request(server).delete(`/knowledge/sources/${created.id}`).expect(204);
            await request(server).get(`/knowledge/sources/${created.id}`).expect(404);
        });

        it('404 при удалении несуществующего', async () => {
            await request(server)
                .delete('/knowledge/sources/11111111-1111-4111-8111-111111111111')
                .expect(404);
        });

        it('аноним не может удалить чужое (ownership)', async () => {
            const userId = '22222222-2222-4222-8222-222222222288';
            const created = await createSource('foreign', userId);
            await request(server).delete(`/knowledge/sources/${created.id}`).expect(404);
            // Всё ещё существует
            await request(server)
                .get(`/knowledge/sources/${created.id}`)
                .set('X-User-Id', userId)
                .expect(200);
        });
    });

    // Хелперы
    async function createSource(suffix: string, userId?: string): Promise<TResponseSource> {
        const req = request(server)
            .post('/knowledge/sources/text')
            .send({ title: `${TEST_TITLE_PREFIX}${suffix}`, rawText: `payload ${suffix}` });
        if (userId) {
            req.set('X-User-Id', userId);
        }
        const response = await req.expect(201);
        return response.body as TResponseSource;
    }
});

async function cleanup(prisma: PrismaService): Promise<void> {
    await prisma.knowledgeSource.deleteMany({
        where: {
            OR: [
                { title: { startsWith: TEST_TITLE_PREFIX } },
                { rawText: { startsWith: 'payload ' } },
                { rawText: { equals: 'без заголовка' } },
                { rawText: { equals: 'ingestion payload для проверки' } },
            ],
        },
    });
}
