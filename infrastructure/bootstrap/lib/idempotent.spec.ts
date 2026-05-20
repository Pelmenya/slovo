import type { FlowiseClient } from '@slovo/flowise-client';
import { ensureResource, type TEnsureContext } from './idempotent';

function buildContext(forceRecreate: boolean): TEnsureContext {
    return {
        flowise: {} as FlowiseClient, // не используется напрямую, прокидывается в params.list/create/delete
        forceRecreate,
        scope: 'test',
    };
}

describe('ensureResource', () => {
    it('returns existing id and action=reused when resource exists (forceRecreate=false)', async () => {
        const list = jest.fn().mockResolvedValue([{ id: 'existing-id', name: 'cred-1' }]);
        const create = jest.fn();
        const deleteById = jest.fn();

        const result = await ensureResource({
            ctx: buildContext(false),
            resourceLabel: 'credential',
            name: 'cred-1',
            list,
            create,
            deleteById,
            extractIdFromCreate: () => 'never',
        });

        expect(result).toEqual({ id: 'existing-id', name: 'cred-1', action: 'reused' });
        expect(create).not.toHaveBeenCalled();
        expect(deleteById).not.toHaveBeenCalled();
    });

    it('creates new resource when none with that name exists', async () => {
        const list = jest.fn().mockResolvedValue([{ id: 'other-id', name: 'cred-2' }]);
        const create = jest.fn().mockResolvedValue({ id: 'new-id' });
        const deleteById = jest.fn();

        const result = await ensureResource({
            ctx: buildContext(false),
            resourceLabel: 'credential',
            name: 'cred-1',
            list,
            create,
            deleteById,
            extractIdFromCreate: (r: { id: string }) => r.id,
        });

        expect(result).toEqual({ id: 'new-id', name: 'cred-1', action: 'created' });
        expect(create).toHaveBeenCalledTimes(1);
        expect(deleteById).not.toHaveBeenCalled();
    });

    it('deletes + recreates when forceRecreate=true and resource exists', async () => {
        const list = jest.fn().mockResolvedValue([{ id: 'old-id', name: 'cred-1' }]);
        const create = jest.fn().mockResolvedValue({ id: 'new-id' });
        const deleteById = jest.fn().mockResolvedValue(undefined);

        const result = await ensureResource({
            ctx: buildContext(true),
            resourceLabel: 'credential',
            name: 'cred-1',
            list,
            create,
            deleteById,
            extractIdFromCreate: (r: { id: string }) => r.id,
        });

        expect(result).toEqual({ id: 'new-id', name: 'cred-1', action: 'recreated' });
        expect(deleteById).toHaveBeenCalledWith('old-id');
        expect(create).toHaveBeenCalledTimes(1);
    });

    it('skips delete when forceRecreate=true but resource does not exist', async () => {
        const list = jest.fn().mockResolvedValue([]);
        const create = jest.fn().mockResolvedValue({ id: 'fresh-id' });
        const deleteById = jest.fn();

        const result = await ensureResource({
            ctx: buildContext(true),
            resourceLabel: 'credential',
            name: 'cred-new',
            list,
            create,
            deleteById,
            extractIdFromCreate: (r: { id: string }) => r.id,
        });

        expect(result.action).toBe('created');
        expect(deleteById).not.toHaveBeenCalled();
    });

    it('matches by exact name (no substring match)', async () => {
        const list = jest.fn().mockResolvedValue([
            { id: 'cred-A', name: 'cred-1' },
            { id: 'cred-B', name: 'cred-10' }, // substring "cred-1" matches partial — но мы matchим точно
        ]);
        const create = jest.fn().mockResolvedValue({ id: 'new' });

        const result = await ensureResource({
            ctx: buildContext(false),
            resourceLabel: 'credential',
            name: 'cred-1',
            list,
            create,
            deleteById: jest.fn(),
            extractIdFromCreate: (r: { id: string }) => r.id,
        });

        expect(result.id).toBe('cred-A');
        expect(result.action).toBe('reused');
    });

    it('propagates create() error', async () => {
        const list = jest.fn().mockResolvedValue([]);
        const create = jest.fn().mockRejectedValue(new Error('Flowise 500'));

        await expect(
            ensureResource({
                ctx: buildContext(false),
                resourceLabel: 'credential',
                name: 'cred-1',
                list,
                create,
                deleteById: jest.fn(),
                extractIdFromCreate: () => 'never',
            }),
        ).rejects.toThrow('Flowise 500');
    });

    it('propagates list() error', async () => {
        const list = jest.fn().mockRejectedValue(new Error('Network error'));

        await expect(
            ensureResource({
                ctx: buildContext(false),
                resourceLabel: 'credential',
                name: 'cred-1',
                list,
                create: jest.fn(),
                deleteById: jest.fn(),
                extractIdFromCreate: () => 'never',
            }),
        ).rejects.toThrow('Network error');
    });
});
