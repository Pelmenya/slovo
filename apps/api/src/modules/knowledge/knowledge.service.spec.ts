import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { KnowledgeSource } from '@prisma/client';
import { PrismaService } from '@slovo/database';
import { KnowledgeService } from './knowledge.service';

type TKnowledgeSourceMock = {
    create: jest.Mock<Promise<KnowledgeSource>, unknown[]>;
    findFirst: jest.Mock<Promise<KnowledgeSource | null>, unknown[]>;
    findMany: jest.Mock<Promise<KnowledgeSource[]>, unknown[]>;
    count: jest.Mock<Promise<number>, unknown[]>;
    delete: jest.Mock<Promise<KnowledgeSource>, unknown[]>;
};

type TPrismaMock = {
    knowledgeSource: TKnowledgeSourceMock;
    $transaction: jest.Mock<Promise<[KnowledgeSource[], number]>, unknown[]>;
};

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
                delete: jest.fn<Promise<KnowledgeSource>, unknown[]>(),
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
                null,
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
            // rawText НЕ должен быть в response (internal field)
            expect(result).not.toHaveProperty('rawText');
        });

        it('при отсутствии title → null', async () => {
            prisma.knowledgeSource.create.mockResolvedValue(buildSource());
            await service.createTextSource({ rawText: 'text' }, null);
            expect(prisma.knowledgeSource.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ title: null }),
                }),
            );
        });

        it('заполняет startedAt и completedAt (синхронно завершено)', async () => {
            prisma.knowledgeSource.create.mockResolvedValue(buildSource());
            await service.createTextSource({ rawText: 'text' }, null);
            expect(prisma.knowledgeSource.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        startedAt: expect.any(Date),
                        completedAt: expect.any(Date),
                    }),
                }),
            );
        });

        it('прокидывает userId если передан', async () => {
            const userId = '00000000-0000-0000-0000-000000000001';
            prisma.knowledgeSource.create.mockResolvedValue(buildSource({ userId }));
            await service.createTextSource({ rawText: 'text' }, userId);
            expect(prisma.knowledgeSource.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ userId }),
                }),
            );
        });
    });

    describe('findById', () => {
        it('возвращает response DTO при успехе', async () => {
            const source = buildSource({ title: 'Найден' });
            prisma.knowledgeSource.findFirst.mockResolvedValue(source);

            const result = await service.findById(source.id, null);
            expect(result.id).toBe(source.id);
            expect(result.title).toBe('Найден');
        });

        it('NotFoundException если не найден', async () => {
            prisma.knowledgeSource.findFirst.mockResolvedValue(null);
            await expect(service.findById('missing', null)).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });

        it('аноним (userId=null) ищет только userId IS NULL', async () => {
            prisma.knowledgeSource.findFirst.mockResolvedValue(buildSource());
            await service.findById('id', null);
            expect(prisma.knowledgeSource.findFirst).toHaveBeenCalledWith({
                where: { id: 'id', userId: null },
            });
        });

        it('авторизованный ищет только свои', async () => {
            const userId = '00000000-0000-0000-0000-000000000001';
            prisma.knowledgeSource.findFirst.mockResolvedValue(buildSource({ userId }));
            await service.findById('id', userId);
            expect(prisma.knowledgeSource.findFirst).toHaveBeenCalledWith({
                where: { id: 'id', userId },
            });
        });
    });

    describe('list', () => {
        it('возвращает paginated response с total', async () => {
            const items = [buildSource({ id: 'a' }), buildSource({ id: 'b' })];
            prisma.$transaction.mockResolvedValue([items, 2]);

            const result = await service.list({ page: 1, limit: 20 }, null);
            expect(result.total).toBe(2);
            expect(result.items).toHaveLength(2);
            expect(result.items[0].id).toBe('a');
            expect(result.page).toBe(1);
            expect(result.limit).toBe(20);
        });

        it('применяет дефолты page=1, limit=20 при пустом query', async () => {
            prisma.$transaction.mockResolvedValue([[], 0]);
            const result = await service.list({}, null);
            expect(result.page).toBe(1);
            expect(result.limit).toBe(20);
        });

        it('применяет фильтры status и sourceType если переданы', async () => {
            prisma.$transaction.mockResolvedValue([[], 0]);
            await service.list(
                { page: 1, limit: 20, status: 'pending', sourceType: 'video' },
                null,
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
            await service.list({ page: 3, limit: 10 }, null);
            expect(prisma.knowledgeSource.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ skip: 20, take: 10 }),
            );
        });

        it('sort по createdAt desc', async () => {
            prisma.$transaction.mockResolvedValue([[], 0]);
            await service.list({}, null);
            expect(prisma.knowledgeSource.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
            );
        });
    });

    describe('delete', () => {
        it('удаляет существующий источник', async () => {
            prisma.knowledgeSource.findFirst.mockResolvedValue(buildSource({ id: 'id' }));
            prisma.knowledgeSource.delete.mockResolvedValue(buildSource({ id: 'id' }));

            await service.delete('id', null);
            expect(prisma.knowledgeSource.delete).toHaveBeenCalledWith({ where: { id: 'id' } });
        });

        it('NotFoundException если не найден (до delete)', async () => {
            prisma.knowledgeSource.findFirst.mockResolvedValue(null);
            await expect(service.delete('missing', null)).rejects.toBeInstanceOf(
                NotFoundException,
            );
            expect(prisma.knowledgeSource.delete).not.toHaveBeenCalled();
        });

        it('проверяет ownership до delete (чужой источник — NotFound)', async () => {
            prisma.knowledgeSource.findFirst.mockResolvedValue(null);
            const userId = '00000000-0000-0000-0000-000000000001';
            await expect(service.delete('id', userId)).rejects.toBeInstanceOf(NotFoundException);
            expect(prisma.knowledgeSource.findFirst).toHaveBeenCalledWith({
                where: { id: 'id', userId },
            });
            expect(prisma.knowledgeSource.delete).not.toHaveBeenCalled();
        });
    });
});
