import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '@slovo/database';
import { HealthResponseDto } from './dto/health-response.dto';
import { ReadinessResponseDto } from './dto/readiness-response.dto';

@ApiTags('Health')
@Controller('health')
export class HealthController {
    private readonly logger = new Logger(HealthController.name);

    constructor(private readonly prisma: PrismaService) {}

    @Get()
    @ApiOperation({ summary: 'Liveness — сервис живой, без внешних зависимостей' })
    @ApiOkResponse({ type: HealthResponseDto })
    ping(): HealthResponseDto {
        return {
            status: 'ok',
            service: 'slovo-api',
            timestamp: new Date().toISOString(),
        };
    }

    @Get('ready')
    @ApiOperation({ summary: 'Readiness — сервис готов принимать трафик (БД доступна)' })
    @ApiOkResponse({ type: ReadinessResponseDto })
    @ApiServiceUnavailableResponse({
        description: 'Хотя бы одна зависимость не готова (например, Postgres)',
        type: ReadinessResponseDto,
    })
    async ready(): Promise<ReadinessResponseDto> {
        const db = await this.checkDatabase();
        const status = db ? 'ok' : 'degraded';
        const response: ReadinessResponseDto = {
            status,
            checks: { db },
            timestamp: new Date().toISOString(),
        };
        if (status !== 'ok') {
            throw new ServiceUnavailableException(response);
        }
        return response;
    }

    private async checkDatabase(): Promise<boolean> {
        try {
            await this.prisma.$queryRaw`SELECT 1`;
            return true;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(`Readiness DB check failed: ${message}`);
            return false;
        }
    }
}
