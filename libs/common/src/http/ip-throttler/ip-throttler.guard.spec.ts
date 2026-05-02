import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
    ThrottlerModuleOptions,
    ThrottlerStorage,
    ThrottlerGuard,
} from '@nestjs/throttler';
import { IpThrottlerGuard } from './ip-throttler.guard';

// Helper для доступа к protected метод getTracker — TestingHelper
class TestableGuard extends IpThrottlerGuard {
    public exposeGetTracker(req: Record<string, unknown>): Promise<string> {
        return this.getTracker(req);
    }
}

describe('IpThrottlerGuard', () => {
    let guard: TestableGuard;

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [
                TestableGuard,
                {
                    provide: 'THROTTLER:MODULE_OPTIONS',
                    useValue: {
                        throttlers: [{ ttl: 60_000, limit: 10 }],
                    } as ThrottlerModuleOptions,
                },
                {
                    provide: ThrottlerStorage,
                    useValue: { increment: jest.fn() } as unknown as ThrottlerStorage,
                },
                Reflector,
            ],
        }).compile();

        guard = moduleRef.get(TestableGuard);
    });

    it('является ThrottlerGuard descendant — глобальный фреймворк-контракт', () => {
        expect(guard).toBeInstanceOf(ThrottlerGuard);
    });

    describe('getTracker — IPv4', () => {
        it('IPv4 → as-is', async () => {
            const tracker = await guard.exposeGetTracker({ ip: '192.0.2.1' });
            expect(tracker).toBe('192.0.2.1');
        });
    });

    describe('getTracker — IPv6 /64-prefix', () => {
        it('IPv6 → первые 4 группы', async () => {
            const tracker = await guard.exposeGetTracker({
                ip: '2001:db8:85a3:8d3:1319:8a2e:370:7348',
            });
            expect(tracker).toBe('2001:db8:85a3:8d3');
        });

        it('IPv6-rotation в одном /64 → один tracker (anti-bypass)', async () => {
            const t1 = await guard.exposeGetTracker({
                ip: '2001:db8:85a3:8d3:1111:1111:1111:1111',
            });
            const t2 = await guard.exposeGetTracker({
                ip: '2001:db8:85a3:8d3:ffff:ffff:ffff:ffff',
            });
            expect(t1).toBe(t2);
        });

        it('IPv4-mapped IPv6 → нормализуется до IPv4', async () => {
            const tracker = await guard.exposeGetTracker({ ip: '::ffff:192.0.2.1' });
            expect(tracker).toBe('192.0.2.1');
        });
    });

    describe('getTracker — graceful', () => {
        it('req.ip undefined → "unknown" (не throw)', async () => {
            const tracker = await guard.exposeGetTracker({});
            expect(tracker).toBe('unknown');
        });
        // Дополнительные не-string кейсы (number/object/null) покрыты в
        // extract-ip-tracker.spec.ts — guard просто прокси к pure function.
    });
});
