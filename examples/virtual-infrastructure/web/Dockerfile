# The demo's web app and its door: the one container reached from outside. Build from the
# repository's root:
#   docker build -f examples/virtual-infrastructure/web/Dockerfile -t virtual-infrastructure-web .
FROM oven/bun:1.4.2-slim AS build

WORKDIR /app

# The lockfile covers the whole workspace, so an install needs every workspace's package.json
COPY package.json bun.lock ./
COPY packages/feathers-connect/package.json packages/feathers-connect/
COPY packages/live-system/package.json packages/live-system/
COPY packages/micro-fsm/package.json packages/micro-fsm/
COPY examples/virtual-infrastructure/data-service/package.json examples/virtual-infrastructure/data-service/
COPY examples/virtual-infrastructure/live-server/package.json examples/virtual-infrastructure/live-server/
COPY examples/virtual-infrastructure/protocol/package.json examples/virtual-infrastructure/protocol/
COPY examples/virtual-infrastructure/web/package.json examples/virtual-infrastructure/web/
RUN bun install --frozen-lockfile --filter @virtual-infrastructure/web

# The web app's tsconfig.json extends the root's
COPY tsconfig.json ./
COPY packages packages
COPY examples/virtual-infrastructure/protocol examples/virtual-infrastructure/protocol
COPY examples/virtual-infrastructure/web examples/virtual-infrastructure/web
RUN cd examples/virtual-infrastructure/web && bun run build

FROM caddy:2-alpine

COPY examples/virtual-infrastructure/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/examples/virtual-infrastructure/web/dist /srv
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

EXPOSE 3032
