# ── build stage ──────────────────────────────────────────────────────────────
# Build the SPA with the same Node major version the project builds with on the
# host (v22). npm ci is used with the inline sources enabled (node 22 default)
# so the layer caches dependencies independently of source changes.
FROM docker.1ms.run/node:22-bookworm-slim AS build
WORKDIR /app

# 1) dependencies only (cached until lockfile changes)
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 2) sources + production build (tsc --noEmit runs inside npm run build)
COPY . .
RUN npm run build

# ── runtime stage ────────────────────────────────────────────────────────────
FROM docker.1ms.run/nginx:alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
