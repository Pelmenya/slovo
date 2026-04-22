import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthResponseDto } from './dto/health-response.dto';

@ApiTags('Health')
@Controller('health')
export class HealthController {
    @Get()
    @ApiOperation({ summary: 'Проверка живости сервиса' })
    @ApiOkResponse({ type: HealthResponseDto })
    ping(): HealthResponseDto {
        return {
            status: 'ok',
            service: 'slovo-api',
            timestamp: new Date().toISOString(),
        };
    }
}
