// Nest CLI по умолчанию помечает всё из node_modules как external (через
// webpack-node-externals). С workspace-символами @slovo/* попадают в external
// и node не может их загрузить как ESM (main указывает на .ts файл).
//
// Этот конфиг отключает externals-поведение для всех @slovo/* пакетов —
// webpack bundl'ит их код в финальный main.js.

const nodeExternals = require('webpack-node-externals');

module.exports = function (options) {
    return {
        ...options,
        externals: [
            nodeExternals({
                allowlist: [/^@slovo\//],
            }),
        ],
    };
};
