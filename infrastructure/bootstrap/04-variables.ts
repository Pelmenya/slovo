/**
 * Step 4 — Flowise Variables (cost-cap thresholds, throttle limits и т.д.).
 *
 * Skeleton — full impl в [TODO infra-bootstrap-feature].
 *
 * План:
 * 1. Прочитать exports/variables.json — массив { name, type, value? }
 *    (value опц для non-secret defaults; для secret — берём из env по
 *    convention `VAR_<UPPER_NAME>`).
 * 2. Для каждого variable — ensureResource через `flowise_variables_create`.
 * 3. Идемпотентно: если variable уже создан с тем же value → skip.
 *
 * Examples:
 * - WATER_ANALYSIS_BUDGET_USD = "300" (static)
 * - CATALOG_VISION_DAILY_CAP_USD = "5" (static)
 * - SLOVO_ADMIN_EMAIL = (из env, runtime per deploy)
 */

import type { FlowiseClient } from '@slovo/flowise-client';
import { logSection } from './lib/idempotent';

const SCOPE = '04-variables';

export async function bootstrapVariables(
    _flowise: FlowiseClient,
    _exportsDir: string,
    _forceRecreate: boolean,
): Promise<void> {
    logSection(SCOPE, 'TODO: Creating Flowise variables from exports/variables.json');
    // TODO:
    // - read exports/variables.json
    // - for each: ensureResource через POST /api/v1/variables
    // - support runtime vars (value из env по name lookup)
}
