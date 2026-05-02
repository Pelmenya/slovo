// =============================================================================
// IP tracker extractor для NestJS Throttler с IPv6-/64-aware key (#65).
//
// Why: distributed botnet тривиально bypass'ит per-IP throttle через IPv6
// rotation — провайдер выдаёт клиенту целый /64-блок (`2^64` адресов).
// Без правильной маски throttle 30/min/IP бот делает 30 × 2^64 запросов
// в минуту, защита нулевая. С /64-маской throttle применяется к одному
// физическому соединению, как было бы с IPv4.
//
// IPv4-mapped IPv6 (`::ffff:192.0.2.1`) — нормализуем до IPv4 (так делает
// большинство load balancers, чтобы не двоить ключ).
//
// Hardening (security review feedback):
// - IPv4 octets валидируются 0-255 (без этого `999.999.999.999` пройдёт)
// - IPv6 группы валидируются как [0-9a-f]{1,4} (без этого мусорный `req.ip`
//   "evil:string:with:colons" даст невалидный tracker)
// - Любой невалидный input → 'unknown' fallback вместо partial match
//
// Pure function — testable без bootstrap NestJS, переиспользуема в любом
// модуле проекта (живёт в libs/common/src/http/ip-throttler/).
// =============================================================================

const IPV4_OCTET_REGEX = /^([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/;
const IPV6_GROUP_REGEX = /^[0-9a-f]{1,4}$/i;

export function extractIpTracker(rawIp: unknown): string {
    if (typeof rawIp !== 'string' || rawIp.length === 0) return 'unknown';

    // IPv4-mapped IPv6: `::ffff:192.0.2.1` (RFC 4291 §2.5.5.2). Нормализуем
    // к IPv4 — иначе один и тот же клиент получит разные tracker'ы при
    // переключении proxy между IPv4/IPv6 stacks.
    const ipv4MappedMatch = rawIp.match(/^::ffff:([\d.]+)$/i);
    if (ipv4MappedMatch) {
        const ipv4 = ipv4MappedMatch[1];
        return isValidIpv4(ipv4) ? ipv4 : 'unknown';
    }

    // Pure IPv4 (no colons) — валидируем 4 octets 0-255.
    if (!rawIp.includes(':')) {
        return isValidIpv4(rawIp) ? rawIp : 'unknown';
    }

    // IPv6 — extract first 4 groups = /64 prefix.
    const groups = expandIpv6(rawIp);
    if (groups.length < 4) return 'unknown';

    const prefixGroups = groups.slice(0, 4);
    if (!prefixGroups.every((g) => IPV6_GROUP_REGEX.test(g))) {
        return 'unknown';
    }
    return prefixGroups.join(':');
}

function isValidIpv4(ipv4: string): boolean {
    const parts = ipv4.split('.');
    if (parts.length !== 4) return false;
    return parts.every((p) => IPV4_OCTET_REGEX.test(p));
}

// Expand IPv6 zero-compression `::` до полных 8 групп.
// `2001:db8::1` → ['2001','db8','0','0','0','0','0','1']
// `::1` → ['0','0','0','0','0','0','0','1']
// `2001:db8:1:2:3:4:5:6` → splits on `:` без расширения.
function expandIpv6(ip: string): string[] {
    if (!ip.includes('::')) {
        return ip.split(':');
    }
    const [head, tail] = ip.split('::');
    const headGroups = head.length > 0 ? head.split(':') : [];
    const tailGroups = tail.length > 0 ? tail.split(':') : [];
    const missing = 8 - headGroups.length - tailGroups.length;
    if (missing < 0) return ip.split(':'); // malformed — fallback
    const zeros = new Array<string>(missing).fill('0');
    return [...headGroups, ...zeros, ...tailGroups];
}
