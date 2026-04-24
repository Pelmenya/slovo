import { ApiProperty } from '@nestjs/swagger';
import { KnowledgeSourceResponseDto } from './knowledge-source.response.dto';

export class PaginatedKnowledgeSourcesResponseDto {
    @ApiProperty({ type: [KnowledgeSourceResponseDto] })
    items!: KnowledgeSourceResponseDto[];

    @ApiProperty({ example: 42 })
    total!: number;

    @ApiProperty({ example: 1 })
    page!: number;

    @ApiProperty({ example: 20 })
    limit!: number;
}
