# EU HTTP-proxy для slovo

> **Статус:** draft 2026-05-20. Отдельный VPS в EU, разворачивается **до** деплоя slovo РФ-узла.

## Зачем

Из РФ нет прямого HTTPS-доступа к `api.anthropic.com` и `api.openai.com` (Cloudflare geo-block). Slovo в проде живёт в РФ (152-ФЗ — PII должна храниться в РФ), а Flowise делает Vision-augmentation / embedding'и через Anthropic+OpenAI. Решение — **HTTP CONNECT-proxy на дешёвом EU VPS**, через который Flowise прокидывает исходящие.

```
[Flowise РФ] ── HTTPS_PROXY=http://eu-proxy:8888 ──→ [tinyproxy EU] ──→ api.anthropic.com
                                                                   ──→ api.openai.com
```

## Минимальные требования

- **VPS:** Hetzner CX11 (1 vCPU, 2GB RAM, 20GB SSD) — ~3 EUR/мес. Регион — Falkenstein/Nuremberg/Helsinki (любой EU без US-санкций к РФ).
- **OS:** Debian 12 или Ubuntu 24.04 с Docker.
- **Network:** static IPv4 (whitelist source IP slovo РФ-узла).
- **DNS (опц):** `proxy.slovo.internal` в Cloudflare (Proxy off) или Hetzner DNS.

## Stack

**tinyproxy** в Alpine-контейнере — самый лёгкий option:

- ~2 MB образ
- HTTP CONNECT support (нужен для HTTPS through-tunneling к Anthropic)
- BasicAuth через `BasicAuth user:password`
- IP allowlist через `Allow x.x.x.x/32` directive

**Альтернативы:**

- **squid** — overkill для нашего сценария (auth-проксирование одной direction). Тяжёлый (~50MB), сложная конфигурация ACL.
- **sing-box / xray** — для случаев когда EU IP в san блок-листах OpenAI (бывает на крупных провайдерах). Сейчас не нужно — Hetzner Falkenstein чистый.
- **mitm + custom auth** — overhead для нашего случая.

## Структура (TODO черновик)

```
infrastructure/eu-proxy/
├── README.md                # этот файл
├── docker-compose.yml       # tinyproxy service
├── tinyproxy.conf           # config с BasicAuth + Allow rule
├── .env.example             # PROXY_USER, PROXY_PASS, ALLOWED_SOURCE_IP
└── scripts/
    ├── deploy.sh            # ssh + docker compose up
    └── healthcheck.sh       # curl --proxy через себя на api.anthropic.com/v1/messages OPTIONS
```

## Usage (планируемый)

```bash
# 1. Поднять EU VPS, скопировать infrastructure/eu-proxy/ на узел
scp -r infrastructure/eu-proxy/ root@eu-vps:/opt/slovo-proxy/
ssh root@eu-vps

# 2. Заполнить .env с реальными секретами
cd /opt/slovo-proxy && cp .env.example .env && vim .env
#   PROXY_USER=slovo
#   PROXY_PASS=<long random>
#   ALLOWED_SOURCE_IP=<IP slovo РФ-узла>

# 3. Запустить proxy
docker compose up -d

# 4. Тест с РФ-узла
curl --proxy http://slovo:<password>@<eu-ip>:8888 \
     --proxy-anyauth \
     -sf https://api.anthropic.com/v1/messages -o /dev/null
# должен вернуть 401 (без API key) — но coннект через прокси работает

# 5. На slovo РФ-узле .env:
#   EU_PROXY_URL=http://slovo:<password>@<eu-ip>:8888
#   EU_PROXY_AUTH=slovo:<password>

# 6. docker-compose.prod.yml для Flowise:
#   environment:
#     - HTTPS_PROXY=${EU_PROXY_URL}
#     - HTTP_PROXY=${EU_PROXY_URL}
#     - NO_PROXY=localhost,127.0.0.1,slovo-postgres,slovo-valkey,slovo-minio,slovo-rabbitmq
```

## Security baseline

- **BasicAuth обязателен** — без него любой ботнет может через ваш узел дёргать Anthropic за ваши деньги.
- **IP allowlist** — только `<slovo РФ-узел>/32`. Никаких `0.0.0.0/0`.
- **HTTPS only** — `DisableViaHeader Yes`, `ConnectPort 443`. Никаких портов кроме 443.
- **Rate limiting** — тяжёлый сценарий, скорее для Phase 2. Сейчас slovo BudgetService capает upstream.
- **Логирование** — `LogLevel Connect` чтобы видеть кто/когда/куда. Логи без request body (HTTPS encrypted), но IP+host видно.
- **Disk quotas** — `LogFileRotation` чтобы не забить диск VPS логами.
- **Auto-update** — `unattended-upgrades` на VPS (security only, не major version).
- **Firewall** — ufw только 22+8888, ничего лишнего.

## Failure modes

| Сценарий | Симптом | Mitigation |
|---|---|---|
| EU VPS даун | Flowise в РФ возвращает 502 на всех Vision/embedding calls | Health-check на slovo стороне, alert в Telegram. Backup proxy URL (второй EU VPS с тем же конфигом). |
| Anthropic блокирует EU IP | `403 Forbidden` от `api.anthropic.com` | Сменить регион EU VPS (Helsinki → Nuremberg), сменить ASN. Hetzner обычно чистый. |
| Proxy auth leak | Незнакомый трафик в логах | Rotate `PROXY_PASS`, обновить slovo `.env`, рестарт Flowise. |
| Trafic spike → биллинг | Anthropic выставит счёт за непрошеные calls | BudgetService на slovo стороне капает upstream + monthly Anthropic billing alert. |

## Стоимость

- **VPS Hetzner CX11:** ~3 EUR/мес ≈ 300 ₽/мес.
- **Трафик:** включён в VPS план (20TB/мес — намного больше чем нам нужно).
- **DNS (опц):** Cloudflare Free / Hetzner DNS бесплатно.

**Итого: ~300 ₽/мес** — это **разумная инфра-косвенная** стоимость для production slovo с LLM в РФ.

## Open questions

- **Один proxy на всех клиентов** vs **per-tenant proxy** — для multi-tenant Phase 6 (когда у каждого Аквафор-дилера свой slovo инстанс) может быть выгоднее single shared proxy или dedicated. Сейчас один на всех.
- **Anthropic biling country** — Anthropic выставляет счёт на тот же business account независимо от source IP. Биллинговые контракты остаются на slovo team, не на EU узел.
- **OpenAI throughput limits** — некоторые EU IP диапазоны имеют tighter rate limits. Hetzner проверен на vision-catalog Phase 1 — без issues при 155 items × Vision call. Если будут problems на массовом trafике — переехать на дешёвый dedicated server.

## Cross-refs

- [infrastructure/bootstrap/README.md](../bootstrap/README.md) — основной prod bootstrap, требует `EU_PROXY_URL` в env.
- [memory: project_flowise_proxy_bootstrap](../../docs/...) — dev-time undici monkey-patch (не нужен в prod, prod использует Flowise env var напрямую).
- [docs/guides/flowise-vs-nestjs.md](../../docs/guides/flowise-vs-nestjs.md) — секция «Доступ из Docker к Anthropic/OpenAI через HTTP-прокси».
- [docs/architecture/decisions/](../../docs/architecture/decisions/) — TODO ADR-009 «slovo prod deployment topology» (split РФ/EU).
