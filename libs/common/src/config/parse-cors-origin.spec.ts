import { parseCorsOrigin } from './parse-cors-origin';

describe('parseCorsOrigin', () => {
    it('возвращает массив из одного origin', () => {
        expect(parseCorsOrigin('http://localhost:3000')).toEqual(['http://localhost:3000']);
    });

    it('разделяет по запятым', () => {
        expect(parseCorsOrigin('http://a.com,http://b.com')).toEqual([
            'http://a.com',
            'http://b.com',
        ]);
    });

    it('обрезает пробелы вокруг origin', () => {
        expect(parseCorsOrigin(' http://a.com , http://b.com ')).toEqual([
            'http://a.com',
            'http://b.com',
        ]);
    });

    it('выкидывает пустые сегменты', () => {
        expect(parseCorsOrigin('http://a.com,,http://b.com,')).toEqual([
            'http://a.com',
            'http://b.com',
        ]);
    });

    it('на пустой строке возвращает пустой массив', () => {
        expect(parseCorsOrigin('')).toEqual([]);
        expect(parseCorsOrigin('   ')).toEqual([]);
        expect(parseCorsOrigin(',,')).toEqual([]);
    });
});
