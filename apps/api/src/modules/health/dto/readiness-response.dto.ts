import { ApiProperty } from '@nestjs/swagger';

export class ReadinessChecksDto {
    @ApiProperty({ example: true, description: 'Доступен ли Postgres через Prisma' })
    db!: boolean;
}

export class ReadinessResponseDto {
    @ApiProperty({
        example: 'ok',
        enum: ['ok', 'degraded'],
        description: 'Суммарная готовность сервиса',
    })
    status!: 'ok' | 'degraded';

    @ApiProperty({ type: ReadinessChecksDto })
    checks!: ReadinessChecksDto;

    @ApiProperty({
        example: '2026-04-22T10:00:00.000Z',
        description: 'ISO-8601 временная метка проверки',
    })
    timestamp!: string;
}
