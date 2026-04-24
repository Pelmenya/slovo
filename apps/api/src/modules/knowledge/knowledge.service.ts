import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type KnowledgeSource, Prisma } from '@prisma/client';
import type { TUserContext } from '@slovo/common';
import { userIdOrNull } from '@slovo/common';
import { PrismaService } from '@slovo/database';
import { CreateTextSourceRequestDto } from './dto/create-text-source.request.dto';
import { KnowledgeSourceResponseDto } from './dto/knowledge-source.response.dto';
import { ListKnowledgeSourcesQueryDto } from './dto/list-knowledge-sources.query.dto';
import { PaginatedKnowledgeSourcesResponseDto } from './dto/paginated-knowledge-sources.response.dto';
import { DEFAULT_PAGE_SIZE } from './knowledge.constants';

// Prisma error codes, которые мы транслируем в HTTP 400.
// P2010 — raw query failure (включая CHECK constraint violations).
// См. https://www.prisma.io/docs/reference/api-reference/error-reference
const PRISMA_CHECK_VIOLATION_CODES: ReadonlySet<string> = new Set(['P2010']);

@Injectable()
export class KnowledgeService {
    private readonly logger = new Logger(KnowledgeService.name);

    constructor(private readonly prisma: PrismaService) {}

    async createTextSource(
        input: CreateTextSourceRequestDto,
        user: TUserContext,
    ): Promise<KnowledgeSourceResponseDto> {
        // Text-адаптер — единственный синхронный путь в Phase 1: никакого worker'а,
        // никакого embedding pipeline (это PR5+). Источник сразу status='ready',
        // потому что текст уже готов как extractedText.
        const now = new Date();
        try {
            const created = await this.prisma.knowledgeSource.create({
                data: {
                    userId: userIdOrNull(user),
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
        } catch (err) {
            // CHECK-constraints (payload_exclusive_chk, progress_range_chk) — на
            // create-пути недостижимы для text-адаптера (мы сами проставляем
            // rawText + progress=100), но код должен быть готов к video/pdf
            // адаптерам в PR5+, где INSERT может нарушить constraint.
            if (isPrismaCheckViolation(err)) {
                throw new BadRequestException(
                    `Data violates database constraints: ${err.message}`,
                );
            }
            throw err;
        }
    }

    async findById(id: string, user: TUserContext): Promise<KnowledgeSourceResponseDto> {
        const source = await this.prisma.knowledgeSource.findFirst({
            where: { id, userId: userIdOrNull(user) },
        });
        if (!source) {
            throw new NotFoundException(`KnowledgeSource ${id} not found`);
        }
        return toResponseDto(source);
    }

    async list(
        query: ListKnowledgeSourcesQueryDto,
        user: TUserContext,
    ): Promise<PaginatedKnowledgeSourcesResponseDto> {
        const page = query.page ?? 1;
        const limit = query.limit ?? DEFAULT_PAGE_SIZE;
        const where: Prisma.KnowledgeSourceWhereInput = {
            userId: userIdOrNull(user),
            ...(query.status !== undefined ? { status: query.status } : {}),
            ...(query.sourceType !== undefined ? { sourceType: query.sourceType } : {}),
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

    async delete(id: string, user: TUserContext): Promise<void> {
        // deleteMany + проверка count одним round-trip'ом — атомарно,
        // убирает race между findById и delete. Если 0 удалено — либо не
        // существует, либо не принадлежит пользователю (404 в обоих случаях,
        // не выдаём разницу наружу чтобы не протекал ownership).
        const { count } = await this.prisma.knowledgeSource.deleteMany({
            where: { id, userId: userIdOrNull(user) },
        });
        if (count === 0) {
            throw new NotFoundException(`KnowledgeSource ${id} not found`);
        }
        // TODO PR5+: ingestion errors записываем в error через sanitizeIngestionError
        // (п.14 tech-debt). На delete-пути — если storageKey заполнен, удалять
        // соответствующий S3 blob через StorageService.
        this.logger.log(`Deleted knowledge source ${id}`);
    }
}

function isPrismaCheckViolation(
    err: unknown,
): err is Prisma.PrismaClientKnownRequestError {
    return (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        PRISMA_CHECK_VIOLATION_CODES.has(err.code)
    );
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
