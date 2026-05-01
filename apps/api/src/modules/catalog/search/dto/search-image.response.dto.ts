import { ApiProperty } from '@nestjs/swagger';
import { SearchTextDocResponseDto } from './search-text.response.dto';

// Output Vision-describer chatflow — структурированный JSON. Поля совпадают
// с промптом vision-catalog-describer-v1 (см. Phase 0 lab journal day 1).
//
// Если возвращается клиенту даже когда `is_relevant=false` — это диагностика
// для UX («AI распознал кота, не оборудование — попробуй другое фото»).
export class VisionOutputDto {
    @ApiProperty({
        description: 'true — на фото оборудование/товар. false — кот/документ/прочее',
        example: true,
    })
    isRelevant!: boolean;

    @ApiProperty({
        description: 'Категория товара (free-form, не enum) или "прочее"',
        example: 'обратный осмос',
        nullable: true,
        type: String,
    })
    category!: string | null;

    @ApiProperty({
        description: 'Бренд если виден на фото',
        example: 'Аквафор',
        nullable: true,
        type: String,
    })
    brand!: string | null;

    @ApiProperty({
        description: 'Модель/артикул если читается на упаковке',
        example: 'DWM-101S',
        nullable: true,
        type: String,
    })
    modelHint!: string | null;

    @ApiProperty({
        description: 'Естественное описание товара на русском — используется как query для search',
        example: 'Кран смеситель для питьевой воды с двумя рычагами',
    })
    descriptionRu!: string;

    @ApiProperty({
        description: 'Уровень уверенности классификатора',
        enum: ['high', 'medium', 'low'],
        example: 'high',
    })
    confidence!: 'high' | 'medium' | 'low';
}

export class SearchImageResponseDto {
    @ApiProperty({ description: 'Сколько документов вернулось (≤ topK)' })
    count!: number;

    @ApiProperty({ type: [SearchTextDocResponseDto] })
    docs!: SearchTextDocResponseDto[];

    @ApiProperty({
        description: 'Время выполнения downstream text-search во Flowise (мс), без Vision pass',
    })
    timeTakenMs!: number;

    @ApiProperty({
        description: 'Output Vision-describer для прозрачности перед клиентом',
        type: VisionOutputDto,
    })
    visionOutput!: VisionOutputDto;
}
