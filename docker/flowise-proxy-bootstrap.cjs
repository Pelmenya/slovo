// Preload-скрипт для Flowise-контейнера.
// Настраивает глобальный undici dispatcher на ProxyAgent, чтобы fetch()
// в Flowise/LangChain выходил в интернет через HTTP-прокси хоста (env HTTP_PROXY).
// Node.js fetch (undici) НЕ читает HTTP_PROXY автоматически — этот скрипт это чинит.
//
// Подключается через NODE_OPTIONS="--require /scripts/flowise-proxy-bootstrap.cjs"
// в docker-compose.infra.yml → flowise.environment.

const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

if (!proxy) {
    return;
}

try {
    // undici лежит внутри Flowise node_modules, не в корне контейнера
    const { setGlobalDispatcher, ProxyAgent } = require(
        '/usr/local/lib/node_modules/flowise/node_modules/undici',
    );
    setGlobalDispatcher(new ProxyAgent(proxy));
    // eslint-disable-next-line no-console
    console.log(`[proxy-bootstrap] undici ProxyAgent set to ${proxy}`);
} catch (err) {
    // eslint-disable-next-line no-console
    console.error('[proxy-bootstrap] failed to init ProxyAgent:', err.message);
}
