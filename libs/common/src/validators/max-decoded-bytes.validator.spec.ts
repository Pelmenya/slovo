import { validate } from 'class-validator';
import { MaxDecodedBytes } from './max-decoded-bytes.validator';

class Subject {
    @MaxDecodedBytes(10)
    field!: string;
}

describe('MaxDecodedBytes', () => {
    it('пропускает base64 ≤ N декодированных байт', async () => {
        const obj = new Subject();
        obj.field = Buffer.from('hello').toString('base64'); // 5 bytes decoded
        const errors = await validate(obj);
        expect(errors).toHaveLength(0);
    });

    it('отбрасывает base64 > N декодированных байт', async () => {
        const obj = new Subject();
        obj.field = Buffer.from('hello world! more').toString('base64'); // 17 bytes > 10
        const errors = await validate(obj);
        expect(errors).toHaveLength(1);
        expect(errors[0].constraints?.maxDecodedBytes).toContain('Decoded byte length');
    });

    it('boundary case — ровно N байт допустимо', async () => {
        const obj = new Subject();
        obj.field = Buffer.from('1234567890').toString('base64'); // exactly 10 bytes
        const errors = await validate(obj);
        expect(errors).toHaveLength(0);
    });

    it('non-string значения отвергает', async () => {
        const obj = new Subject();
        // @ts-expect-error — намеренный wrong-type
        obj.field = 12345;
        const errors = await validate(obj);
        expect(errors).toHaveLength(1);
    });

    it('пустая строка → 0 декодированных байт → допустима', async () => {
        const obj = new Subject();
        obj.field = '';
        const errors = await validate(obj);
        expect(errors).toHaveLength(0);
    });
});
