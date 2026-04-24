import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { MAX_TEXT_SOURCE_LENGTH } from '../knowledge.constants';

// Отдельный request-DTO для text-адаптера (не generated).
// Поля userId/sourceType/status/progress/startedAt/completedAt/error — internal,
// ставятся сервисом, не принимаются от клиента. Это закрывает п.13 tech-debt.md.
// Phase 1: metadata не принимается от клиента. Phase 2 — появится metadata?:
// Record<string, unknown> с zod-валидацией (п.15 tech-debt). При добавлении поля
// это не breaking change: клиенты просто не передают его до обновления контракта.
export class CreateTextSourceRequestDto {
    @ApiPropertyOptional({
        description: 'Человекочитаемое название источника',
        example: 'Методика подбора оборудования для скважин — Аквафор 2025',
        maxLength: 256,
    })
    @IsOptional()
    @IsString()
    @MaxLength(256)
    title?: string;

    @ApiProperty({
        description: 'Сырой текст источника (будет проиндексирован для RAG)',
        example: 'Обратный осмос применяется при высокой минерализации...',
        minLength: 1,
        maxLength: MAX_TEXT_SOURCE_LENGTH,
    })
    @IsString()
    @Length(1, MAX_TEXT_SOURCE_LENGTH)
    rawText!: string;
}
