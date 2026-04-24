import { InternalServerErrorException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { DevOnlyHeaderAuthGuard } from './dev-only-header-auth.guard';

// Минимальный type для mock — ровно что нужно guard'у. Cast через unknown
// в конкретный ConfigService<TAppEnv, true> тянул бы 60+ полей env.
function makeGuard(nodeEnv: string): DevOnlyHeaderAuthGuard {
    const mockConfig = {
        get: jest.fn().mockReturnValue(nodeEnv),
    };
    return new DevOnlyHeaderAuthGuard(mockConfig as never);
}

const FAKE_CTX = {} as ExecutionContext;

describe('DevOnlyHeaderAuthGuard', () => {
    it('пропускает в development', () => {
        expect(makeGuard('development').canActivate(FAKE_CTX)).toBe(true);
    });

    it('пропускает в test', () => {
        expect(makeGuard('test').canActivate(FAKE_CTX)).toBe(true);
    });

    it('бросает InternalServerErrorException в production', () => {
        expect(() => makeGuard('production').canActivate(FAKE_CTX)).toThrow(
            InternalServerErrorException,
        );
    });
});
