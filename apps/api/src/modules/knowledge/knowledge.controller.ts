import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    UseGuards,
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
import { Throttle } from '@nestjs/throttler';
import {
    DevOnlyHeaderAuthGuard,
    type TUserContext,
    USER_ID_HEADER,
    UserContext,
} from '@slovo/common';
import { CreateTextSourceRequestDto } from './dto/create-text-source.request.dto';
import { KnowledgeSourceResponseDto } from './dto/knowledge-source.response.dto';
import { ListKnowledgeSourcesQueryDto } from './dto/list-knowledge-sources.query.dto';
import { PaginatedKnowledgeSourcesResponseDto } from './dto/paginated-knowledge-sources.response.dto';
import { KnowledgeService } from './knowledge.service';

// Phase 1 auth-заглушка: userId берём из X-User-Id header через @UserContext().
// Guard DevOnlyHeaderAuthGuard роняет любой запрос в production — чтобы
// случайный деплой в prod с этим header'ом не стал mult-tenancy bypass'ом.
//
// FIXME PR-auth: удалить @UseGuards(DevOnlyHeaderAuthGuard) вместе с USER_ID_HEADER
// и заменить @UserContext() на @User() из JWT guard'а — без этого spoofing
// остаётся боевым.
@ApiTags('knowledge')
@Controller('knowledge/sources')
@UseGuards(DevOnlyHeaderAuthGuard)
export class KnowledgeController {
    constructor(private readonly service: KnowledgeService) {}

    @Post('text')
    // Более строгий лимит чем глобальный (100/min из AppModule). Text-ingestion
    // принимает payload до 500KB — каждый запрос тяжелее обычного. 10/min/IP
    // достаточно для dev-использования, предотвращает burst-DoS.
    @Throttle({ default: { limit: 10, ttl: 60_000 } })
    @ApiOperation({
        summary: 'Создать text-источник (Phase 1 синхронный ingestion)',
        description:
            'Загружает сырой текст в knowledge base. Источник сразу переходит в status=ready. ' +
            'В PR5+ здесь же будет отправка в Flowise upsert для векторизации.',
    })
    @ApiHeader({
        name: USER_ID_HEADER,
        required: false,
        description: 'UUIDv4 пользователя (временная заглушка до JWT). Без header — anonymous.',
    })
    @ApiCreatedResponse({ type: KnowledgeSourceResponseDto })
    createText(
        @Body() dto: CreateTextSourceRequestDto,
        @UserContext() user: TUserContext,
    ): Promise<KnowledgeSourceResponseDto> {
        return this.service.createTextSource(dto, user);
    }

    @Get()
    @ApiOperation({ summary: 'Список источников с pagination и фильтрами' })
    @ApiHeader({ name: USER_ID_HEADER, required: false })
    @ApiOkResponse({ type: PaginatedKnowledgeSourcesResponseDto })
    list(
        @Query() query: ListKnowledgeSourcesQueryDto,
        @UserContext() user: TUserContext,
    ): Promise<PaginatedKnowledgeSourcesResponseDto> {
        return this.service.list(query, user);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Один источник по id' })
    @ApiHeader({ name: USER_ID_HEADER, required: false })
    @ApiOkResponse({ type: KnowledgeSourceResponseDto })
    @ApiNotFoundResponse({ description: 'Источник не найден или нет доступа' })
    findOne(
        @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
        @UserContext() user: TUserContext,
    ): Promise<KnowledgeSourceResponseDto> {
        return this.service.findById(id, user);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Удалить источник' })
    @ApiHeader({ name: USER_ID_HEADER, required: false })
    @ApiNoContentResponse()
    @ApiNotFoundResponse({ description: 'Источник не найден или нет доступа' })
    delete(
        @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
        @UserContext() user: TUserContext,
    ): Promise<void> {
        return this.service.delete(id, user);
    }
}
