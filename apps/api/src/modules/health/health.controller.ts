import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
@Controller('health')
export class HealthController {
    @Get()
    @ApiOperation({ summary: 'Проверка живости сервиса' })
    ping() {
        return {
            status: 'ok',
            service: 'slovo-api',
            timestamp: new Date().toISOString(),
        };
    }
}
