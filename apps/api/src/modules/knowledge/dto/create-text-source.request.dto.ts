import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

// Отдельный request-DTO для text-адаптера (не generated).
// Поля userId/sourceType/status/progress/startedAt/completedAt/error — internal,
// ставятся сервисом, не принимаются от клиента. Это закрывает п.13 tech-debt.md.
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
        maxLength: 500_000,
    })
    @IsString()
    @Length(1, 500_000)
    rawText!: string;
}
