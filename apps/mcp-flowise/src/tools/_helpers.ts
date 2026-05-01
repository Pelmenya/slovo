import { formatFlowiseError } from '@slovo/flowise-client';
import type { TToolResult } from './t-tool';

/**
 * Оборачивает handler в try/catch с унифицированным форматированием ошибок.
 * Снимает 57 копипастов `try { ... } catch (e) { return { success:false, error:formatErrorForMcp(e) } }`.
 */
export async function withErrorHandling<T>(
    fn: () => Promise<T>,
): Promise<TToolResult<T>> {
    try {
        const data = await fn();
        return { success: true, data };
    } catch (error) {
        return { success: false, error: formatFlowiseError(error) };
    }
}

/**
 * Собирает query-объект с фильтрацией undefined-значений.
 * Использовать для list-handler'ов с опциональными фильтрами (chatmessage, upsert_history, ...).
 */
export function buildQuery(
    fields: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean | undefined> {
    return fields;
}
