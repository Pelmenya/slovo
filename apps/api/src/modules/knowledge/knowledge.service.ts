import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { KnowledgeSource, Prisma } from '@prisma/client';
import { PrismaService } from '@slovo/database';
import { CreateTextSourceRequestDto } from './dto/create-text-source.request.dto';
import { KnowledgeSourceResponseDto } from './dto/knowledge-source.response.dto';
import { ListKnowledgeSourcesQueryDto } from './dto/list-knowledge-sources.query.dto';
import { PaginatedKnowledgeSourcesResponseDto } from './dto/paginated-knowledge-sources.response.dto';

@Injectable()
export class KnowledgeService {
    private readonly logger = new Logger(KnowledgeService.name);

    constructor(private readonly prisma: PrismaService) {}

    async createTextSource(
        input: CreateTextSourceRequestDto,
        userId: string | null,
    ): Promise<KnowledgeSourceResponseDto> {
        // Text-адаптер — единственный синхронный путь в Phase 1: никакого worker'а,
        // никакого embedding pipeline (это PR5+). Источник сразу status='ready',
        // потому что текст уже готов как extractedText. Позже, когда появится
        // Flowise upsert — здесь будет status='processing' + отправка в очередь.
        const now = new Date();
        const created = await this.prisma.knowledgeSource.create({
            data: {
                userId,
                sourceType: 'text',
                status: 'ready',
                progress: 100,
                title: input.title ?? null,
                rawText: input.rawText,
                extractedText: input.rawText,
                startedAt: now,
                completedAt: now,
            },
        });
        this.logger.log(`Created text source ${created.id} (${input.rawText.length} chars)`);
        return toResponseDto(created);
    }

    async findById(id: string, userId: string | null): Promise<KnowledgeSourceResponseDto> {
        const source = await this.prisma.knowledgeSource.findFirst({
            where: { id, ...ownershipFilter(userId) },
        });
        if (!source) {
            throw new NotFoundException(`KnowledgeSource ${id} not found`);
        }
        return toResponseDto(source);
    }

    async list(
        query: ListKnowledgeSourcesQueryDto,
        userId: string | null,
    ): Promise<PaginatedKnowledgeSourcesResponseDto> {
        const page = query.page ?? 1;
        const limit = query.limit ?? 20;
        const where: Prisma.KnowledgeSourceWhereInput = {
            ...ownershipFilter(userId),
            ...(query.status !== undefined && { status: query.status }),
            ...(query.sourceType !== undefined && { sourceType: query.sourceType }),
        };
        const [items, total] = await this.prisma.$transaction([
            this.prisma.knowledgeSource.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.knowledgeSource.count({ where }),
        ]);
        return {
            items: items.map(toResponseDto),
            total,
            page,
            limit,
        };
    }

    async delete(id: string, userId: string | null): Promise<void> {
        // Проверяем существование + ownership до delete — иначе prisma.delete
        // бросает P2025 (generic "not found") без контекста.
        await this.findById(id, userId);
        await this.prisma.knowledgeSource.delete({ where: { id } });
        // TODO PR5+: если storageKey заполнен — каскадно удалить S3 blob через StorageService.
        this.logger.log(`Deleted knowledge source ${id}`);
    }
}

// Phase 1 auth-заглушка: если userId=null (аноним) — показываем только
// "orphaned" источники (userId IS NULL). Когда появится JWT, userId=null
// станет недопустимым на уровне guard'а, а эта функция превратится в
// `{ userId }` без ветвления. Пока так: тестируем без auth.
function ownershipFilter(userId: string | null): Prisma.KnowledgeSourceWhereInput {
    return userId === null ? { userId: null } : { userId };
}

function toResponseDto(source: KnowledgeSource): KnowledgeSourceResponseDto {
    return {
        id: source.id,
        userId: source.userId,
        sourceType: source.sourceType,
        status: source.status,
        progress: source.progress,
        title: source.title,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
        startedAt: source.startedAt,
        completedAt: source.completedAt,
    };
}
