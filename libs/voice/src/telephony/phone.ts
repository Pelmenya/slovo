/**
 * Номер для PJSIP-транка: провайдер (Novofon) ждёт 7XXXXXXXXXX без «+».
 * Вынесено из транспорта отдельно, чтобы правило проверялось тестами, а не звонком.
 */
export function normalizePhoneForTrunk(phone: string): string {
    const trimmed = phone.trim();

    if (!isE164(trimmed)) {
        throw new Error(`Номер "${phone}" не в формате E.164 (ожидается +79991234567)`);
    }

    return trimmed.slice(1);
}

export function isE164(phone: string): boolean {
    return /^\+[1-9]\d{9,14}$/.test(phone.trim());
}
