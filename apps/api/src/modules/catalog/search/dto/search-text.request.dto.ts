import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import {
    CATALOG_DEFAULT_TOP_K,
    CATALOG_MAX_QUERY_LENGTH,
    CATALOG_MAX_TOP_K,
    CATALOG_MIN_TOP_K,
} from '../../catalog.constants';

// Двойные декораторы (class-validator + @nestjs/swagger) — обязательное правило
// slovo: validation runtime + Swagger schema из одного источника. ValidationPipe
// в main.ts (whitelist + forbidNonWhitelisted) автоматически отбрасывает левые
// поля и валидирует типы. См. CLAUDE.md секция «class-validator + @nestjs/swagger».
export class SearchTextRequestDto {
    @ApiProperty({
        description: 'Поисковый запрос на естественном языке',
        example: 'фильтр для жёсткой воды',
        minLength: 1,
        maxLength: CATALOG_MAX_QUERY_LENGTH,
    })
    @IsString()
    @Length(1, CATALOG_MAX_QUERY_LENGTH)
    query!: string;

    @ApiPropertyOptional({
        description: 'Сколько top-K документов вернуть',
        default: CATALOG_DEFAULT_TOP_K,
        minimum: CATALOG_MIN_TOP_K,
        maximum: CATALOG_MAX_TOP_K,
    })
    @IsOptional()
    @IsInt()
    @Min(CATALOG_MIN_TOP_K)
    @Max(CATALOG_MAX_TOP_K)
    topK?: number;
}
