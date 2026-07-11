# syntax=docker/dockerfile:1.7

FROM node:24.17.0-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_MANUAL_SIG_HANDLE=true \
    REGSPAN_SHUTDOWN_GRACE_MS=330000 \
    NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 10001 regspan \
    && useradd --system --uid 10001 --gid regspan --home-dir /nonexistent --shell /usr/sbin/nologin regspan \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn*

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/scripts/runtimePreflight.mjs ./scripts/runtimePreflight.mjs
COPY --from=builder /app/scripts/container-entrypoint.sh ./scripts/container-entrypoint.sh
COPY --from=builder /app/lib/pdfParserWorker.js ./lib/pdfParserWorker.js
COPY --from=builder /app/lib/productionHostSafety.mjs ./lib/productionHostSafety.mjs

RUN mkdir -p /app/.next/cache \
    && chown regspan:regspan /app/.next/cache

USER 10001:10001
EXPOSE 3000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["sh", "/app/scripts/container-entrypoint.sh"]
