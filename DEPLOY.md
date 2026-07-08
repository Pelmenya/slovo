# Slovo deploy runbook

Документ фиксирует практический деплой `slovo` на РФ dev/prod-сервере с отдельным EU proxy для Anthropic/OpenAI. Проверено на Ubuntu 24.04.

## Топология

```text
prostor-app /smart-search/* -> slovo-api:3101
slovo-api -> local Postgres/Valkey/RabbitMQ/Flowise
Flowise -> HTTPS_PROXY -> EU tinyproxy -> api.anthropic.com / api.openai.com
```

На dev-стенде `slovo-api` запущен через `systemd` на host, а infra через Docker:

- `slovo-postgres` на `127.0.0.1:5433`;
- `slovo-valkey` на `127.0.0.1:6380`;
- `slovo-rabbitmq` на `127.0.0.1:5672`;
- `slovo-flowise` на `127.0.0.1:3130`;
- `slovo-api.service` на `127.0.0.1:3101`.

## EU proxy

На EU VPS:

```bash
cd ~
git clone <slovo-repo-url> slovo
cd ~/slovo/infrastructure/eu-proxy
cp .env.example .env
nano .env
```

Минимум:

```env
PROXY_PORT=8888
PROXY_BIND_HOST=0.0.0.0
PROXY_USER=slovo
PROXY_PASS=<long-random-password>
ALLOWED_SOURCE_IP=<rf-server-ip>
```

Запуск:

```bash
docker compose up -d --build
docker compose ps
ss -ltnp | grep 8888 || true
```

Проверка с РФ сервера:

```bash
curl --proxy http://slovo:<password>@<eu-ip>:8888 \
  -I https://api.openai.com/v1/models
```

Важные грабли:

- `ALLOWED_SOURCE_IP` для tinyproxy лучше задавать как plain IP, если entrypoint пишет `Allow $ALLOWED_SOURCE_IP`;
- `LogFile "/dev/stdout"` может падать с permission denied, используйте обычный файл в `/var/log/tinyproxy`;
- для self-test из контейнера нужен `Allow 127.0.0.1`, для Docker bridge часто нужен `Allow 172.16.0.0/12`;
- если не используете `ufw`, проверьте правила firewall у провайдера.

## Env на РФ сервере

```bash
cd ~/slovo
cp .env.example .env
nano .env
```

Минимум для host/systemd запуска:

```env
NODE_ENV=development
API_PORT=3101
CORS_ORIGIN=https://ak-prostore.ru,http://localhost:3000
LOG_LEVEL=info

POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5433
POSTGRES_USER=slovo
POSTGRES_PASSWORD=<password>
POSTGRES_DB=slovo
DATABASE_URL=postgresql://slovo:<password>@127.0.0.1:5433/slovo?schema=public
SHADOW_DATABASE_URL=postgresql://slovo:<password>@127.0.0.1:5433/slovo_shadow?schema=public

REDIS_HOST=127.0.0.1
REDIS_PORT=6380
REDIS_PASSWORD=

RABBITMQ_HOST=127.0.0.1
RABBITMQ_PORT=5672
RABBITMQ_MANAGEMENT_PORT=15672
RABBITMQ_USER=slovo
RABBITMQ_PASSWORD=<password>
RABBITMQ_URL=amqp://slovo:<password>@127.0.0.1:5672

FLOWISE_PORT=3130
FLOWISE_API_URL=http://127.0.0.1:3130
FLOWISE_API_KEY=<create-in-flowise-ui>
HOST_HTTP_PROXY=http://slovo:<proxy-password>@<eu-ip>:8888

S3_ENDPOINT=https://s3.twcstorage.ru
S3_REGION=ru-1
S3_ACCESS_KEY=<s3-access-key>
S3_SECRET_KEY=<s3-secret-key>
S3_BUCKET=<bucket>
S3_CATALOG_BUCKET=<bucket>
S3_FORCE_PATH_STYLE=true

ANTHROPIC_API_KEY=<anthropic-key>
OPENAI_API_KEY=<openai-key>
OPENAI_BASE_URL=https://api.openai.com/v1

JWT_SECRET=<openssl-rand-hex-32>
JWT_EXPIRES_IN=7d
TRUSTED_PROXY_HOPS=1

TELEGRAM_BOT_TOKEN=
TELEGRAM_ALERT_CHAT_IDS=
TELEGRAM_ALERTS_ENABLED=false
```

Почему `NODE_ENV=development` на dev-стенде: текущий production env guard требует `REDIS_PASSWORD`, а `docker-compose.infra.yml` поднимает Valkey без `requirepass`. Перед настоящим production лучше либо включить пароль в Valkey, либо привести env guard и compose к одному контракту.

## Infra

```bash
docker compose -f docker-compose.infra.yml up -d --build postgres valkey rabbitmq flowise

until docker exec slovo-postgres pg_isready -U slovo -d slovo; do sleep 2; done
until curl -sf http://127.0.0.1:3130/api/v1/ping >/dev/null; do sleep 2; done
curl -s http://127.0.0.1:3130/api/v1/ping && echo
```

Если Docker Hub отдает `429 Too Many Requests` на `pgvector/pgvector`, временно используйте mirror:

```bash
cp docker/postgres/Dockerfile docker/postgres/Dockerfile.before-mirror
sed -i 's#FROM pgvector/pgvector:0.8.2-pg18-trixie#FROM mirror.gcr.io/pgvector/pgvector:0.8.2-pg18-trixie#' docker/postgres/Dockerfile
docker compose -f docker-compose.infra.yml build postgres
docker compose -f docker-compose.infra.yml up -d postgres valkey rabbitmq flowise
```

Альтернатива: `docker login`, затем повторить build.

## Build и миграции

```bash
if ! command -v node >/dev/null 2>&1 || [ "$(node -p "Number(process.versions.node.split('.')[0])")" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

cd ~/slovo
npm install
npm run prisma:generate
npm run prisma:migrate:deploy
npm run build:api
```

Если `npm ci` падает из-за рассинхрона `package-lock.json` и workspaces, на сервере используйте `npm install`.

## systemd service

```bash
cat > /etc/systemd/system/slovo-api.service <<'EOF'
[Unit]
Description=Slovo AI API
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/root/slovo
EnvironmentFile=/root/slovo/.env
ExecStart=/usr/bin/npm run start:prod
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now slovo-api
```

Проверки:

```bash
systemctl status slovo-api --no-pager
journalctl -u slovo-api -n 120 --no-pager -l
curl -i http://127.0.0.1:3101/health
curl -i http://127.0.0.1:3101/health/ready
```

`/health/ready` должен вернуть `200` и `"db":true`.

## Flowise API key

Flowise UI не выставляем наружу. Используйте SSH tunnel:

```powershell
ssh -L 3130:127.0.0.1:3130 root@<rf-server-ip>
```

Открыть `http://localhost:3130`, создать API key, вставить в `FLOWISE_API_KEY`, затем:

```bash
systemctl restart slovo-api
curl -i http://127.0.0.1:3101/health/ready
```

## Подключение к frontend

Если frontend запущен в Docker, а `slovo-api` на host, контейнеру фронта нужен gateway Docker-сети:

```bash
SLOVO_GATEWAY="$(docker network inspect crm_network_prod -f '{{(index .IPAM.Config 0).Gateway}}')"
```

В `prostor-app/.env`:

```env
NEXT_PUBLIC_SLOVO_API_URL=/smart-search
INTERNAL_SLOVO_API_URL=http://<gateway>:3101
```

Smoke через frontend:

```bash
curl -i http://127.0.0.1:3010/smart-search/health/ready
curl -i https://ak-prostore.ru/smart-search/health/ready
```

