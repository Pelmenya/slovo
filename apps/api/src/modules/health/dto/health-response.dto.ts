import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
    @ApiProperty({ example: 'ok', description: 'Статус сервиса' })
    status!: 'ok';

    @ApiProperty({ example: 'slovo-api', description: 'Имя сервиса' })
    service!: string;

    @ApiProperty({
        example: '2026-04-22T10:00:00.000Z',
        description: 'ISO-8601 временная метка формирования ответа',
    })
    timestamp!: string;
}
