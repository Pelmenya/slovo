import {
    Body,
    Controller,
    Delete,
    Get,
    Headers,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
} from '@nestjs/common';
import {
    ApiCreatedResponse,
    ApiHeader,
    ApiNoContentResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
} from '@nestjs/swagger';
import { CreateTextSourceRequestDto } from './dto/create-text-source.request.dto';
import { KnowledgeSourceResponseDto } from './dto/knowledge-source.response.dto';
import { ListKnowledgeSourcesQueryDto } from './dto/list-knowledge-sources.query.dto';
import { PaginatedKnowledgeSourcesResponseDto } from './dto/paginated-knowledge-sources.response.dto';
import { KnowledgeService } from './knowledge.service';

// Phase 1 auth-заглушка: userId берём из X-User-Id header. Если его нет —
// работаем в anonymous-режиме (userId=null → orphan-записи). Когда появится
// JWT (PR auth), @Headers('x-user-id') будет заменён на @User() из guard'а.
const USER_ID_HEADER = 'x-user-id';

@ApiTags('knowledge')
@Controller('knowledge/sources')
export class KnowledgeController {
    constructor(private readonly service: KnowledgeService) {}

    @Post('text')
    @ApiOperation({
        summary: 'Создать text-источник (Phase 1 синхронный ingestion)',
        description:
            'Загружает сырой текст в knowledge base. Источник сразу переходит в status=ready. ' +
            'В PR5+ здесь же будет отправка в Flowise upsert для векторизации.',
    })
    @ApiHeader({
        name: USER_ID_HEADER,
        required: false,
        description: 'UUID пользователя (временная заглушка до JWT). Без него — anonymous.',
    })
    @ApiCreatedResponse({ type: KnowledgeSourceResponseDto })
    createText(
        @Body() dto: CreateTextSourceRequestDto,
        @Headers(USER_ID_HEADER) userId?: string,
    ): Promise<KnowledgeSourceResponseDto> {
        return this.service.createTextSource(dto, userId ?? null);
    }

    @Get()
    @ApiOperation({ summary: 'Список источников с pagination и фильтрами' })
    @ApiHeader({ name: USER_ID_HEADER, required: false })
    @ApiOkResponse({ type: PaginatedKnowledgeSourcesResponseDto })
    list(
        @Query() query: ListKnowledgeSourcesQueryDto,
        @Headers(USER_ID_HEADER) userId?: string,
    ): Promise<PaginatedKnowledgeSourcesResponseDto> {
        return this.service.list(query, userId ?? null);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Один источник по id' })
    @ApiHeader({ name: USER_ID_HEADER, required: false })
    @ApiOkResponse({ type: KnowledgeSourceResponseDto })
    @ApiNotFoundResponse({ description: 'Источник не найден или нет доступа' })
    findOne(
        @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
        @Headers(USER_ID_HEADER) userId?: string,
    ): Promise<KnowledgeSourceResponseDto> {
        return this.service.findById(id, userId ?? null);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Удалить источник' })
    @ApiHeader({ name: USER_ID_HEADER, required: false })
    @ApiNoContentResponse()
    @ApiNotFoundResponse({ description: 'Источник не найден или нет доступа' })
    delete(
        @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
        @Headers(USER_ID_HEADER) userId?: string,
    ): Promise<void> {
        return this.service.delete(id, userId ?? null);
    }
}
