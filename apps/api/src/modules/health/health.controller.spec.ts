import { HealthController } from './health.controller';

describe('HealthController', () => {
    let controller: HealthController;

    beforeEach(() => {
        controller = new HealthController();
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
