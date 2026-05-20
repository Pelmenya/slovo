/**
 * Manifest of exported Flowise resources — quick overview без чтения всех JSON.
 *
 * Генерируется `prod:export`, читается `prod:bootstrap` для idempotent diff
 * (compare flowiseUpdatedDate в manifest vs current deployed).
 */

export type TManifestChatflow = {
    name: string;
    /** Относительный путь к JSON файлу внутри exports/ */
    fileRelPath: string;
    /** UUID в Flowise на момент экспорта (для traceability, не для bootstrap). */
    flowiseId: string;
    /** ISO timestamp последнего обновления в Flowise. Используется для idempotent diff. */
    flowiseUpdatedDate: string;
    type: 'CHATFLOW' | 'AGENTFLOW' | 'MULTIAGENT' | 'ASSISTANT';
    nodeCount: number;
    edgeCount: number;
};

export type TManifestDocStore = {
    name: string;
    fileRelPath: string;
    flowiseId: string;
    flowiseUpdatedDate: string;
    /** Тип loader'а — plainText / s3File / json. Для документации. */
    loaderType: string;
    /** Количество loader-files в store на момент экспорта. */
    loaderCount: number;
};

export type TManifestVariable = {
    name: string;
    /** Тип значения — для документации. Реальное значение либо из env, либо
     * в variables.json если non-secret default. */
    type: 'static' | 'runtime';
};

export type TBootstrapManifest = {
    /** ISO timestamp экспорта. */
    exportedAt: string;
    /** git user.name на момент экспорта. */
    exportedBy: string;
    /** Версия bootstrap toolкита (semver `infrastructure/bootstrap/package.json`). */
    bootstrapVersion: string;
    /** URL Flowise из которого делали export — для audit. */
    flowiseApiUrl: string;
    chatflows: TManifestChatflow[];
    documentStores: TManifestDocStore[];
    variables: TManifestVariable[];
};

export const MANIFEST_FILE_NAME = 'manifest.json';
