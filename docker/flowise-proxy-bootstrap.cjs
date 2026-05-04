// Preload-скрипт для Flowise-контейнера.
// Настраивает глобальный undici dispatcher на ProxyAgent для outbound через
// HTTP_PROXY (VPN) — fetch() в Flowise/LangChain без этого не читает HTTP_PROXY.
//
// ВАЖНО: учитываем NO_PROXY — иначе запросы к внутри-докер сервисам
// (autocache, langfuse, и т.д.) уходят на host HTTP-proxy и не резолвятся.
// undici ProxyAgent сам NO_PROXY НЕ парсит — нужен EnvHttpProxyAgent.
// Прецедент 2026-05-04: ANTHROPIC_BASE_URL=http://autocache:8080 ломался
// потому что bootstrap слал в host proxy, autocache не резолвился.
//
// Подключается через NODE_OPTIONS="--require /scripts/flowise-proxy-bootstrap.cjs"
// в docker-compose.infra.yml → flowise.environment.

const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

if (!proxy) {
    return;
}

try {
    // undici лежит внутри Flowise node_modules, не в корне контейнера
    const undici = require('/usr/local/lib/node_modules/flowise/node_modules/undici');
    const { setGlobalDispatcher, EnvHttpProxyAgent, ProxyAgent } = undici;

    // EnvHttpProxyAgent читает HTTP_PROXY/HTTPS_PROXY/NO_PROXY из env и
    // правильно bypass'ит хосты из NO_PROXY (включая wildcards .domain).
    // Появился в undici 5.16+ (наш Flowise 3.1.2 → undici 6.x — поддерживает).
    if (typeof EnvHttpProxyAgent === 'function') {
        setGlobalDispatcher(new EnvHttpProxyAgent());
        // eslint-disable-next-line no-console
        console.log(`[proxy-bootstrap] undici EnvHttpProxyAgent set (proxy=${proxy}, NO_PROXY=${process.env.NO_PROXY || ''})`);
    } else {
        // Fallback на старый ProxyAgent (без NO_PROXY уважения).
        setGlobalDispatcher(new ProxyAgent(proxy));
        // eslint-disable-next-line no-console
        console.log(`[proxy-bootstrap] undici ProxyAgent set to ${proxy} (NO_PROXY НЕ уважается — обнови undici до 5.16+)`);
    }
} catch (err) {
    // eslint-disable-next-line no-console
    console.error('[proxy-bootstrap] failed to init ProxyAgent:', err.message);
}
