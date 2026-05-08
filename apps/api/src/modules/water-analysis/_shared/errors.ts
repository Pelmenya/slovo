// =============================================================================
// Shared error stringifier. Дублировался ×5 (heatmap, predict, depth-map,
// depth-predict, points, equipment-suggest, aquifer-stats — все логируют
// cache errors через `logger.warn`).
// =============================================================================

export function stringifyError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return typeof err === 'string' ? err : JSON.stringify(err);
}
