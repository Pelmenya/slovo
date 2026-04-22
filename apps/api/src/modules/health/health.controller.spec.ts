import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '@slovo/database';
import { HealthController } from './health.controller';

function makePrismaMock(
    queryRawImpl?: jest.Mock,
): Pick<PrismaService, '$queryRaw'> & { $queryRaw: jest.Mock } {
    return {
        $queryRaw: queryRawImpl ?? jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
}

describe('HealthController', () => {
    describe('ping (liveness)', () => {
        let controller: HealthController;

        beforeEach(() => {
            controller = new HealthController(makePrismaMock() as unknown as PrismaService);
        });

        it('возвращает status=ok и service=slovo-api', () => {
            const response = controller.ping();
            expect(response.status).toBe('ok');
            expect(response.service).toBe('slovo-api');
        });

        it('возвращает валидный ISO-8601 timestamp', () => {
            const response = controller.ping();
            expect(typeof response.timestamp).toBe('string');
            expect(Date.parse(response.timestamp)).not.toBeNaN();
        });

        it('timestamp — свежий (в пределах 1 секунды от вызова)', () => {
            const before = Date.now();
            const response = controller.ping();
            const after = Date.now();
            const ts = Date.parse(response.timestamp);
            expect(ts).toBeGreaterThanOrEqual(before - 1);
            expect(ts).toBeLessThanOrEqual(after + 1);
        });
    });

    describe('ready (readiness)', () => {
        it('возвращает status=ok и checks.db=true когда Postgres отвечает', async () => {
            const prisma = makePrismaMock();
            const controller = new HealthController(prisma as unknown as PrismaService);

            const response = await controller.ready();

            expect(response.status).toBe('ok');
            expect(response.checks.db).toBe(true);
            expect(typeof response.timestamp).toBe('string');
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        });

        it('кидает ServiceUnavailableException когда $queryRaw падает', async () => {
            const prisma = makePrismaMock(jest.fn().mockRejectedValue(new Error('connection refused')));
            const controller = new HealthController(prisma as unknown as PrismaService);
            const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

            await expect(controller.ready()).rejects.toThrow(ServiceUnavailableException);
            expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('connection refused'));
            errSpy.mockRestore();
        });

        it('в ответе ServiceUnavailableException содержится status=degraded и checks.db=false', async () => {
            const prisma = makePrismaMock(jest.fn().mockRejectedValue(new Error('boom')));
            const controller = new HealthController(prisma as unknown as PrismaService);
            jest.spyOn(Logger.prototype, 'error').mockImplementation();

            try {
                await controller.ready();
                fail('ожидали исключение');
            } catch (err) {
                expect(err).toBeInstanceOf(ServiceUnavailableException);
                const response = (err as ServiceUnavailableException).getResponse() as {
                    status: string;
                    checks: { db: boolean };
                };
                expect(response.status).toBe('degraded');
                expect(response.checks.db).toBe(false);
            }
        });
    });
});
