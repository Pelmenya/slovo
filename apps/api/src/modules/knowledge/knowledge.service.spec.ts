import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { type KnowledgeSource, Prisma } from '@prisma/client';
import type { TUserContext } from '@slovo/common';
import { PrismaService } from '@slovo/database';
import { KnowledgeService } from './knowledge.service';

type TKnowledgeSourceMock = {
    create: jest.Mock<Promise<KnowledgeSource>, unknown[]>;
    findFirst: jest.Mock<Promise<KnowledgeSource | null>, unknown[]>;
    findMany: jest.Mock<Promise<KnowledgeSource[]>, unknown[]>;
    count: jest.Mock<Promise<number>, unknown[]>;
    deleteMany: jest.Mock<Promise<Prisma.BatchPayload>, unknown[]>;
};

type TPrismaMock = {
    knowledgeSource: TKnowledgeSourceMock;
    $transaction: jest.Mock<Promise<[KnowledgeSource[], number]>, unknown[]>;
};

const ANON: TUserContext = { anonymous: true };

function withUser(userId: string): TUserContext {
    return { userId };
}

function buildSource(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
    const now = new Date('2026-04-24T06:00:00Z');
    return {
        id: '479d5323-4268-4add-8ea6-76cd21ad892d',
        userId: null,
        sourceType: 'text',
        status: 'ready',
        progress: 100,
        title: null,
        storageKey: null,
        sourceUrl: null,
        rawText: 'payload',
        extractedText: 'payload',
        metadata: null,
        error: null,
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        completedAt: now,
        ...overrides,
    };
}

describe('KnowledgeService', () => {
    let service: KnowledgeService;
    let prisma: TPrismaMock;

    beforeEach(async () => {
        prisma = {
            knowledgeSource: {
                create: jest.fn<Promise<KnowledgeSource>, unknown[]>(),
                findFirst: jest.fn<Promise<KnowledgeSource | null>, unknown[]>(),
                findMany: jest.fn<Promise<KnowledgeSource[]>, unknown[]>(),
                count: jest.fn<Promise<number>, unknown[]>(),
                deleteMany: jest.fn<Promise<Prisma.BatchPayload>, unknown[]>(),
            },
            $transaction: jest.fn<Promise<[KnowledgeSource[], number]>, unknown[]>(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                KnowledgeService,
                { provide: PrismaService, useValue: prisma },
            ],
        }).compile();

        service = module.get<KnowledgeService>(KnowledgeService);
    });

    describe('createTextSource', () => {
        it('создаёт источник с sourceType=text и status=ready', async () => {
            prisma.knowledgeSource.create.mockResolvedValue(
                buildSource({ title: 'Методика', rawText: 'text' }),
            );

            const result = await service.createTextSource(
                { title: 'Методика', rawText: 'text' },
                ANON,
            );

            expect(prisma.knowledgeSource.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        sourceType: 'text',
                        status: 'ready',
                        progress: 100,
                        title: 'Методика',
                        rawText: 'text',
                        extractedText: 'text',
                        userId: null,
                    }),
                }),
            );
            expect(result.status).toBe('ready');
            expect(result.progress).toBe(100);
            expect(result).not.toHaveProperty('rawText');
        });

        it('при отсутствии title → null', async () => {
            prisma.knowledgeSource.create.mockResolvedValue(buildSource());
            await service.createTextSource({ rawText: 'text' }, ANON);
            expect(prisma.knowledgeSource.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ title: null }),
                }),
            );
        });

        it('заполняет startedAt и completedAt', async () => {
            prisma.knowledgeSource.create.mockResolvedValue(buildSource());
            await service.createTextSource({ rawText: 'text' }, ANON);
            expect(prisma.knowledgeSource.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        startedAt: expect.any(Date),
                        completedAt: expect.any(Date),
                    }),
                }),
            );
        });

        it('прокидывает userId из TUserContext', async () => {
            const userId = '00000000-0000-0000-0000-000000000001';
            prisma.knowledgeSource.create.mockResolvedValue(buildSource({ userId }));
            await service.createTextSource({ rawText: 'text' }, withUser(userId));
            expect(prisma.knowledgeSource.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ userId }),
                }),
            );
        });

        it('CHECK-constraint violation (P2010) → BadRequestException', async () => {
            const err = new Prisma.PrismaClientKnownRequestError(
                'violates check constraint knowledge_sources_progress_range_chk',
                { code: 'P2010', clientVersion: '7.7.0' },
            );
            prisma.knowledgeSource.create.mockRejectedValue(err);

            await expect(
                service.createTextSource({ rawText: 'text' }, ANON),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('прочие Prisma ошибки пробрасываются', async () => {
            prisma.knowledgeSource.create.mockRejectedValue(new Error('DB down'));
            await expect(
                service.createTextSource({ rawText: 'text' }, ANON),
            ).rejects.toThrow('DB down');
        });
    });

    describe('findById', () => {
        it('возвращает response DTO при успехе', async () => {
            const source = buildSource({ title: 'Найден' });
            prisma.knowledgeSource.findFirst.mockResolvedValue(source);

            const result = await service.findById(source.id, ANON);
            expect(result.id).toBe(source.id);
            expect(result.title).toBe('Найден');
        });

        it('NotFoundException если не найден', async () => {
            prisma.knowledgeSource.findFirst.mockResolvedValue(null);
            await expect(service.findById('missing', ANON)).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });

        it('аноним ищет только userId IS NULL', async () => {
            prisma.knowledgeSource.findFirst.mockResolvedValue(buildSource());
            await service.findById('id', ANON);
            expect(prisma.knowledgeSource.findFirst).toHaveBeenCalledWith({
                where: { id: 'id', userId: null },
            });
        });

        it('авторизованный ищет только свои', async () => {
            const userId = '00000000-0000-0000-0000-000000000001';
            prisma.knowledgeSource.findFirst.mockResolvedValue(buildSource({ userId }));
            await service.findById('id', withUser(userId));
            expect(prisma.knowledgeSource.findFirst).toHaveBeenCalledWith({
                where: { id: 'id', userId },
            });
        });

        it('foreign userId → 404 (не видит чужое)', async () => {
            // В БД источник с userId=owner, но запрос с userId=attacker.
            // findFirst вернёт null из-за where-фильтра на SQL-уровне.
            prisma.knowledgeSource.findFirst.mockResolvedValue(null);
            const attacker = '00000000-0000-0000-0000-00000000dead';
            await expect(
                service.findById('id-owned-by-other', withUser(attacker)),
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(prisma.knowledgeSource.findFirst).toHaveBeenCalledWith({
                where: { id: 'id-owned-by-other', userId: attacker },
            });
        });
    });

    describe('list', () => {
        it('возвращает paginated response с total', async () => {
            const items = [buildSource({ id: 'a' }), buildSource({ id: 'b' })];
            prisma.$transaction.mockResolvedValue([items, 2]);

            const result = await service.list({ page: 1, limit: 20 }, ANON);
            expect(result.total).toBe(2);
            expect(result.items).toHaveLength(2);
            expect(result.items[0].id).toBe('a');
            expect(result.page).toBe(1);
            expect(result.limit).toBe(20);
        });

        it('применяет дефолты page=1, limit=20 при пустом query', async () => {
            prisma.$transaction.mockResolvedValue([[], 0]);
            const result = await service.list({}, ANON);
            expect(result.page).toBe(1);
            expect(result.limit).toBe(20);
        });

        it('применяет фильтры status и sourceType если переданы', async () => {
            prisma.$transaction.mockResolvedValue([[], 0]);
            await service.list(
                { page: 1, limit: 20, status: 'pending', sourceType: 'video' },
                ANON,
            );
            expect(prisma.knowledgeSource.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        status: 'pending',
                        sourceType: 'video',
                        userId: null,
                    }),
                }),
            );
        });

        it('pagination: skip = (page-1)*limit, take = limit', async () => {
            prisma.$transaction.mockResolvedValue([[], 0]);
            await service.list({ page: 3, limit: 10 }, ANON);
            expect(prisma.knowledgeSource.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ skip: 20, take: 10 }),
            );
        });

        it('sort по createdAt desc', async () => {
            prisma.$transaction.mockResolvedValue([[], 0]);
            await service.list({}, ANON);
            expect(prisma.knowledgeSource.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
            );
        });
    });

    describe('delete', () => {
        it('удаляет существующий источник (deleteMany)', async () => {
            prisma.knowledgeSource.deleteMany.mockResolvedValue({ count: 1 });
            await service.delete('id', ANON);
            expect(prisma.knowledgeSource.deleteMany).toHaveBeenCalledWith({
                where: { id: 'id', userId: null },
            });
        });

        it('NotFoundException если count=0', async () => {
            prisma.knowledgeSource.deleteMany.mockResolvedValue({ count: 0 });
            await expect(service.delete('missing', ANON)).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });

        it('foreign userId → 404 (чужое не удаляет)', async () => {
            prisma.knowledgeSource.deleteMany.mockResolvedValue({ count: 0 });
            const attacker = '00000000-0000-0000-0000-00000000dead';
            await expect(
                service.delete('id-owned-by-other', withUser(attacker)),
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(prisma.knowledgeSource.deleteMany).toHaveBeenCalledWith({
                where: { id: 'id-owned-by-other', userId: attacker },
            });
        });
    });
});
