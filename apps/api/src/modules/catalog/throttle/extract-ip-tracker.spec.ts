import { extractIpTracker } from './extract-ip-tracker';

describe('extractIpTracker', () => {
    describe('graceful fallback', () => {
        it('undefined → "unknown"', () => {
            expect(extractIpTracker(undefined)).toBe('unknown');
        });

        it('null → "unknown"', () => {
            expect(extractIpTracker(null)).toBe('unknown');
        });

        it('empty string → "unknown"', () => {
            expect(extractIpTracker('')).toBe('unknown');
        });
    });

    describe('IPv4', () => {
        it('обычный IPv4 → as-is (целый адрес как tracker)', () => {
            expect(extractIpTracker('192.0.2.1')).toBe('192.0.2.1');
        });

        it('localhost IPv4 → as-is', () => {
            expect(extractIpTracker('127.0.0.1')).toBe('127.0.0.1');
        });

        it('private IPv4 → as-is', () => {
            expect(extractIpTracker('10.0.0.1')).toBe('10.0.0.1');
            expect(extractIpTracker('172.16.0.1')).toBe('172.16.0.1');
            expect(extractIpTracker('192.168.1.1')).toBe('192.168.1.1');
        });
    });

    describe('IPv4-mapped IPv6 (RFC 4291 §2.5.5.2)', () => {
        it('::ffff:192.0.2.1 → 192.0.2.1 (нормализация к IPv4)', () => {
            expect(extractIpTracker('::ffff:192.0.2.1')).toBe('192.0.2.1');
        });

        it('::FFFF:127.0.0.1 → 127.0.0.1 (uppercase)', () => {
            expect(extractIpTracker('::FFFF:127.0.0.1')).toBe('127.0.0.1');
        });

        it('::ffff:10.0.0.1 → 10.0.0.1 (private)', () => {
            expect(extractIpTracker('::ffff:10.0.0.1')).toBe('10.0.0.1');
        });
    });

    describe('IPv6 — /64 prefix extraction', () => {
        it('full IPv6 → первые 4 группы', () => {
            expect(extractIpTracker('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe(
                '2001:db8:85a3:8d3',
            );
        });

        it('IPv6 с :: zero-compression → expand + первые 4 группы', () => {
            // 2001:db8::1 = 2001:db8:0:0:0:0:0:1
            expect(extractIpTracker('2001:db8::1')).toBe('2001:db8:0:0');
        });

        it('IPv6 с :: в начале (::1 = localhost) → 0:0:0:0', () => {
            expect(extractIpTracker('::1')).toBe('0:0:0:0');
        });

        it('IPv6 :: (all zeros) → 0:0:0:0', () => {
            expect(extractIpTracker('::')).toBe('0:0:0:0');
        });

        it('IPv6 mid-:: → правильное расширение', () => {
            // 2001:db8::ff:fe:1:2 = 2001:db8:0:0:ff:fe:1:2
            expect(extractIpTracker('2001:db8::ff:fe:1:2')).toBe('2001:db8:0:0');
        });

        it('IPv6 с trailing :: → 4 группы из head', () => {
            // 2001:db8:1:2:: = 2001:db8:1:2:0:0:0:0
            expect(extractIpTracker('2001:db8:1:2::')).toBe('2001:db8:1:2');
        });

        it('бот ротирует IPv6 в одном /64 → один tracker', () => {
            const ip1 = '2001:db8:85a3:8d3:1111:1111:1111:1111';
            const ip2 = '2001:db8:85a3:8d3:2222:2222:2222:2222';
            const ip3 = '2001:db8:85a3:8d3::ffff';
            expect(extractIpTracker(ip1)).toBe(extractIpTracker(ip2));
            expect(extractIpTracker(ip1)).toBe(extractIpTracker(ip3));
        });

        it('разные /64 → разные trackers', () => {
            const ip1 = '2001:db8:85a3:8d3::1';
            const ip2 = '2001:db8:85a3:0001::1';
            expect(extractIpTracker(ip1)).not.toBe(extractIpTracker(ip2));
        });
    });

    describe('malformed input — defensive fallback', () => {
        it('IPv6 с too many groups — fallback на split as-is', () => {
            // 9 групп (некорректно, но не throw)
            const malformed = '1:2:3:4:5:6:7:8:9';
            const result = extractIpTracker(malformed);
            // first 4 groups = '1:2:3:4'
            expect(result).toBe('1:2:3:4');
        });

        it('IPv6 с :: и too many fixed groups — fallback', () => {
            // :: с уже 8 группами (некорректно)
            const malformed = '1:2:3:4:5:6:7:8::9';
            const result = extractIpTracker(malformed);
            // expandIpv6 видит missing<0, возвращает split as-is = ['1','2',...,'9']
            // first 4 = '1:2:3:4'
            expect(result).toBe('1:2:3:4');
        });

        it('одиночный токен без : — IPv4-like fallback', () => {
            expect(extractIpTracker('foo')).toBe('foo');
        });
    });
});
