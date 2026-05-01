import { FlowiseError, formatFlowiseError } from './errors';

describe('formatFlowiseError', () => {
    it('форматирует FlowiseError с HTTP кодом', () => {
        const err = new FlowiseError('Not found', 404, { code: 'X' });
        expect(formatFlowiseError(err)).toBe('Not found — HTTP 404');
    });

    it('FlowiseError без кода — только message', () => {
        const err = new FlowiseError('Generic failure');
        expect(formatFlowiseError(err)).toBe('Generic failure');
    });

    it('обычный Error — message', () => {
        expect(formatFlowiseError(new Error('boom'))).toBe('boom');
    });

    it('строка — как есть', () => {
        expect(formatFlowiseError('plain string')).toBe('plain string');
    });

    it('неизвестный объект — String(...)', () => {
        expect(formatFlowiseError({ x: 1 })).toBe('[object Object]');
    });
});
