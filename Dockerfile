ARG NODE_BASE_IMAGE=node:22-bookworm-slim
FROM ${NODE_BASE_IMAGE} AS base
LABEL com.3dprinta.project="shop"

ENV PNPM_HOME="/pnpm" \
    PATH="$PNPM_HOME:$PATH"

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" \
    AUTH_SECRET="build-time-placeholder" \
    NEXT_PUBLIC_SITE_URL="https://sidzen.shop" \
    NODE_OPTIONS="--max-old-space-size=1536"
RUN pnpm build

FROM dependencies AS migrator

COPY . .
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"
RUN pnpm prisma generate
CMD ["sh", "-c", "pnpm prisma migrate deploy && pnpm db:seed"]

FROM migrator AS marketplace-worker
ENV NODE_ENV=production
RUN mkdir -p /app/public/uploads/products /app/privacy-ledger && chown 1001:1001 /app/public/uploads/products /app/privacy-ledger
RUN chmod 0700 /app/privacy-ledger
USER 1001:1001
CMD ["./node_modules/.bin/tsx", "scripts/marketplace-worker.ts"]

FROM base AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME="0.0.0.0"

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
RUN mkdir -p /app/private-uploads /app/public/uploads/products /app/.next/cache/images /app/.next/cache/fetch-cache \
  && chown nextjs:nodejs /app/private-uploads /app/public/uploads/products /app/.next/cache /app/.next/cache/images /app/.next/cache/fetch-cache
RUN mkdir -p /app/privacy-ledger && chown nextjs:nodejs /app/privacy-ledger
RUN chmod 0700 /app/privacy-ledger

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
