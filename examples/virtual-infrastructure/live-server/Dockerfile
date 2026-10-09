# The demo's live server. Build from the repository's root:
#   docker build -f examples/virtual-infrastructure/live-server/Dockerfile -t virtual-infrastructure-live-server .
FROM oven/bun:1.4.2-slim

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
RUN bun install --frozen-lockfile --production --filter @virtual-infrastructure/live-server

COPY packages packages
COPY examples/virtual-infrastructure/protocol examples/virtual-infrastructure/protocol
COPY examples/virtual-infrastructure/live-server examples/virtual-infrastructure/live-server

# The data service, by its name on the containers' network
ENV DATA_SERVICE_URL=http://data-service:3030

USER bun
WORKDIR /app/examples/virtual-infrastructure/live-server
EXPOSE 3031
CMD ["bun", "src/main.ts"]
