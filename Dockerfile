# Multi-stage: the toolchain and sources stay out of the runtime image.
FROM node:24-slim AS build
WORKDIR /app

# Baileys needs a C toolchain for its optional native deps; sharp needs libvips.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# Manifests first, so a source-only change does not reinstall the world.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig*.json ./
COPY lib/db/package.json                 lib/db/
COPY lib/api-spec/package.json           lib/api-spec/
COPY lib/api-zod/package.json            lib/api-zod/
COPY lib/api-client-react/package.json   lib/api-client-react/
COPY lib/menu-shared/package.json        lib/menu-shared/
COPY artifacts/api-server/package.json   artifacts/api-server/
COPY artifacts/whatsapp-blast/package.json artifacts/whatsapp-blast/
COPY artifacts/menu-web/package.json     artifacts/menu-web/
COPY scripts/package.json                scripts/
RUN pnpm install --frozen-lockfile=false

COPY . .
RUN pnpm run typecheck:libs \
 && pnpm --filter @workspace/api-server run build \
 && pnpm --filter @workspace/whatsapp-blast run build \
 && pnpm --filter @workspace/menu-web run build

# ── Runtime ───────────────────────────────────────────────────────
FROM node:24-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl postgresql-client \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8080
ENV MEDIA_DIR=/data/uploads

# The API is bundled to a single file, so only its externals need to be present.
COPY --from=build /app/artifacts/api-server/dist        ./dist
COPY --from=build /app/node_modules                     ./node_modules
COPY --from=build /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules
COPY --from=build /app/lib/db/migrations                ./migrations
COPY --from=build /app/scripts/ops                      ./ops
# The server serves both front ends itself, from these paths relative to ./dist
# (app.ts → ../../whatsapp-blast/dist/public, lib/menu/web.ts → ../../menu-web/dist).
COPY --from=build /app/artifacts/whatsapp-blast/dist    /whatsapp-blast/dist
COPY --from=build /app/artifacts/menu-web/dist          /menu-web/dist

RUN mkdir -p /data/uploads
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/api/healthz || exit 1

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
