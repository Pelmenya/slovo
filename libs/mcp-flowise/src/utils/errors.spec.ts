import { FlowiseError, formatErrorForMcp } from './errors';

describe('formatErrorForMcp', () => {
    it('форматирует FlowiseError с HTTP кодом', () => {
        const err = new FlowiseError('Not found', 404, { code: 'X' });
        expect(formatErrorForMcp(err)).toBe('Not found — HTTP 404');
    });

    it('FlowiseError без кода — только message', () => {
        const err = new FlowiseError('Generic failure');
        expect(formatErrorForMcp(err)).toBe('Generic failure');
    });

    it('обычный Error — message', () => {
        expect(formatErrorForMcp(new Error('boom'))).toBe('boom');
    });

    it('строка — как есть', () => {
        expect(formatErrorForMcp('plain string')).toBe('plain string');
    });

    it('неизвестный объект — String(...)', () => {
        expect(formatErrorForMcp({ x: 1 })).toBe('[object Object]');
    });
});
