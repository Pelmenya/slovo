export function parseCorsOrigin(raw: string): string[] {
    return raw
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}
