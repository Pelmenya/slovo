ARG NODE_IMAGE=dockerhub.timeweb.cloud/library/node:24.15-slim

FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/mcp-flowise/package.json apps/mcp-flowise/package.json
COPY libs/common/package.json libs/common/package.json
COPY libs/database/package.json libs/database/package.json
COPY libs/flowise-client/package.json libs/flowise-client/package.json
COPY libs/flowise-flowdata/package.json libs/flowise-flowdata/package.json
COPY libs/llm/package.json libs/llm/package.json
COPY libs/storage/package.json libs/storage/package.json
COPY libs/water-blank-extraction/package.json libs/water-blank-extraction/package.json
COPY infrastructure/bootstrap/package.json infrastructure/bootstrap/package.json
RUN npm ci --no-audit --no-fund

FROM deps AS builder
COPY . .
RUN DATABASE_URL=postgresql://slovo:slovo@localhost:5432/slovo?schema=public \
    SHADOW_DATABASE_URL=postgresql://slovo:slovo@localhost:5432/slovo_shadow?schema=public \
    npm run prisma:generate \
    && npm run build:api \
    && npm run build:worker

FROM base AS runner
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

EXPOSE 3101
CMD ["node", "dist/apps/api/main"]
