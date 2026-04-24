import {
    CanActivate,
    ExecutionContext,
    Injectable,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TAppEnv } from '../config/env.schema';

// Guard-барьер против включения X-User-Id header-auth в production.
// Применяется на endpoints, которые читают USER_ID_HEADER. Если NODE_ENV=production —
// бросает 500 с понятным сообщением, чтобы деплой упал на первом же запросе,
// а не работал в mult-tenancy-bypass режиме незаметно.
//
// FIXME: удалить вместе с USER_ID_HEADER и декоратором @UserContext() когда
// появится полноценный JWT guard. См. docs/architecture/tech-debt.md п.20.
@Injectable()
export class DevOnlyHeaderAuthGuard implements CanActivate {
    private readonly logger = new Logger(DevOnlyHeaderAuthGuard.name);

    constructor(private readonly config: ConfigService<TAppEnv, true>) {}

    canActivate(_context: ExecutionContext): boolean {
        const nodeEnv = this.config.get('NODE_ENV', { infer: true });
        if (nodeEnv === 'production') {
            this.logger.error(
                'DevOnlyHeaderAuthGuard triggered in production — X-User-Id auth stub must be replaced with JWT guard before prod deploy',
            );
            throw new InternalServerErrorException(
                'Authentication not configured',
            );
        }
        return true;
    }
}
