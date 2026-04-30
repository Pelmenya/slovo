import { getConfig, resetConfigForTests } from './config';

describe('mcp-flowise config', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        resetConfigForTests();
    });

    afterAll(() => {
        process.env = originalEnv;
        resetConfigForTests();
    });

    it('применяет дефолты при наличии минимально-обязательного API_KEY', () => {
        process.env = { FLOWISE_API_KEY: 'k1' };
        const cfg = getConfig();
        expect(cfg.FLOWISE_API_URL).toBe('http://127.0.0.1:3130');
        expect(cfg.FLOWISE_API_KEY).toBe('k1');
        expect(cfg.FLOWISE_REQUEST_TIMEOUT_MS).toBe(30000);
        expect(cfg.FLOWISE_THROTTLE_MS).toBe(50);
        expect(cfg.FLOWISE_MAX_RETRIES).toBe(3);
    });

    it('кэширует результат — повторный вызов не ре-парсит env', () => {
        process.env = { FLOWISE_API_KEY: 'k1' };
        const a = getConfig();
        process.env.FLOWISE_API_KEY = 'k2';
        const b = getConfig();
        expect(a).toBe(b);
        expect(b.FLOWISE_API_KEY).toBe('k1');
    });

    it('падает понятным сообщением если API_KEY пуст', () => {
        process.env = {};
        expect(() => getConfig()).toThrow(/FLOWISE_API_KEY/);
    });

    it('падает если URL не URL', () => {
        process.env = { FLOWISE_API_KEY: 'k1', FLOWISE_API_URL: 'not-a-url' };
        expect(() => getConfig()).toThrow(/Invalid mcp-flowise environment/);
    });

    it('coerce string→number для числовых вар', () => {
        process.env = {
            FLOWISE_API_KEY: 'k1',
            FLOWISE_REQUEST_TIMEOUT_MS: '5000',
            FLOWISE_THROTTLE_MS: '0',
            FLOWISE_MAX_RETRIES: '1',
        };
        const cfg = getConfig();
        expect(cfg.FLOWISE_REQUEST_TIMEOUT_MS).toBe(5000);
        expect(cfg.FLOWISE_THROTTLE_MS).toBe(0);
        expect(cfg.FLOWISE_MAX_RETRIES).toBe(1);
    });
});
