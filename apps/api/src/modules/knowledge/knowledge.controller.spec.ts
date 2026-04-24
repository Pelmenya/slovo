import { Test, type TestingModule } from '@nestjs/testing';
import { DevOnlyHeaderAuthGuard, type TUserContext } from '@slovo/common';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import type { KnowledgeSourceResponseDto } from './dto/knowledge-source.response.dto';
import type { PaginatedKnowledgeSourcesResponseDto } from './dto/paginated-knowledge-sources.response.dto';

type TKnowledgeServiceMock = {
    createTextSource: jest.Mock<Promise<KnowledgeSourceResponseDto>, unknown[]>;
    findById: jest.Mock<Promise<KnowledgeSourceResponseDto>, unknown[]>;
    list: jest.Mock<Promise<PaginatedKnowledgeSourcesResponseDto>, unknown[]>;
    delete: jest.Mock<Promise<void>, unknown[]>;
};

const ANON: TUserContext = { anonymous: true };
const USER_UUID = '00000000-0000-0000-0000-000000000001';
const USER: TUserContext = { userId: USER_UUID };

const SAMPLE_RESPONSE: KnowledgeSourceResponseDto = {
    id: '479d5323-4268-4add-8ea6-76cd21ad892d',
    userId: null,
    sourceType: 'text',
    status: 'ready',
    progress: 100,
    title: 'Методика',
    createdAt: new Date('2026-04-24T06:00:00Z'),
    updatedAt: new Date('2026-04-24T06:00:00Z'),
    startedAt: new Date('2026-04-24T06:00:00Z'),
    completedAt: new Date('2026-04-24T06:00:00Z'),
};

describe('KnowledgeController', () => {
    let controller: KnowledgeController;
    let service: TKnowledgeServiceMock;

    beforeEach(async () => {
        service = {
            createTextSource: jest.fn<Promise<KnowledgeSourceResponseDto>, unknown[]>(),
            findById: jest.fn<Promise<KnowledgeSourceResponseDto>, unknown[]>(),
            list: jest.fn<Promise<PaginatedKnowledgeSourcesResponseDto>, unknown[]>(),
            delete: jest.fn<Promise<void>, unknown[]>(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [KnowledgeController],
            providers: [{ provide: KnowledgeService, useValue: service }],
        })
            // Guard-логика (throw на NODE_ENV=production) проверяется отдельным
            // спеком guard'а и e2e. Здесь нам важно только делегирование в service.
            .overrideGuard(DevOnlyHeaderAuthGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get<KnowledgeController>(KnowledgeController);
    });

    describe('POST /knowledge/sources/text', () => {
        it('делегирует в service с dto + user context', async () => {
            service.createTextSource.mockResolvedValue(SAMPLE_RESPONSE);

            const result = await controller.createText(
                { title: 'Методика', rawText: 'текст' },
                USER,
            );

            expect(service.createTextSource).toHaveBeenCalledWith(
                { title: 'Методика', rawText: 'текст' },
                USER,
            );
            expect(result).toBe(SAMPLE_RESPONSE);
        });

        it('работает с anonymous контекстом', async () => {
            service.createTextSource.mockResolvedValue(SAMPLE_RESPONSE);
            await controller.createText({ rawText: 'текст' }, ANON);
            expect(service.createTextSource).toHaveBeenCalledWith(
                { rawText: 'текст' },
                ANON,
            );
        });
    });

    describe('GET /knowledge/sources', () => {
        it('прокидывает query и user в service.list', async () => {
            const page: PaginatedKnowledgeSourcesResponseDto = {
                items: [SAMPLE_RESPONSE],
                total: 1,
                page: 1,
                limit: 20,
            };
            service.list.mockResolvedValue(page);

            const result = await controller.list({ page: 1, limit: 20 }, USER);
            expect(service.list).toHaveBeenCalledWith({ page: 1, limit: 20 }, USER);
            expect(result).toBe(page);
        });
    });

    describe('GET /knowledge/sources/:id', () => {
        it('делегирует в service.findById с user', async () => {
            service.findById.mockResolvedValue(SAMPLE_RESPONSE);
            const result = await controller.findOne(SAMPLE_RESPONSE.id, USER);
            expect(service.findById).toHaveBeenCalledWith(SAMPLE_RESPONSE.id, USER);
            expect(result).toBe(SAMPLE_RESPONSE);
        });

        it('anonymous контекст', async () => {
            service.findById.mockResolvedValue(SAMPLE_RESPONSE);
            await controller.findOne(SAMPLE_RESPONSE.id, ANON);
            expect(service.findById).toHaveBeenCalledWith(SAMPLE_RESPONSE.id, ANON);
        });
    });

    describe('DELETE /knowledge/sources/:id', () => {
        it('делегирует в service.delete с user', async () => {
            service.delete.mockResolvedValue(undefined);
            await controller.delete(SAMPLE_RESPONSE.id, USER);
            expect(service.delete).toHaveBeenCalledWith(SAMPLE_RESPONSE.id, USER);
        });

        it('возвращает void', async () => {
            service.delete.mockResolvedValue(undefined);
            const result = await controller.delete(SAMPLE_RESPONSE.id, ANON);
            expect(result).toBeUndefined();
        });
    });
});
