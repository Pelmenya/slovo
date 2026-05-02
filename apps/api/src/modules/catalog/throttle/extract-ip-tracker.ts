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
// Pure function чтобы переиспользовать в spec'ах без бутстрапа NestJS.
// =============================================================================

export function extractIpTracker(rawIp: string | undefined | null): string {
    if (!rawIp) return 'unknown';

    // IPv4-mapped IPv6: `::ffff:192.0.2.1` (RFC 4291 §2.5.5.2). Нормализуем
    // к IPv4 — иначе один и тот же клиент получит разные tracker'ы при
    // переключении proxy между IPv4/IPv6 stacks.
    const ipv4MappedMatch = rawIp.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (ipv4MappedMatch) return ipv4MappedMatch[1];

    // Pure IPv4 (no colons) — целый IP как tracker.
    if (!rawIp.includes(':')) return rawIp;

    // IPv6 — extract first 4 groups = /64 prefix.
    const groups = expandIpv6(rawIp);
    if (groups.length < 4) return rawIp; // defensive — malformed IP, fallback
    return groups.slice(0, 4).join(':');
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
