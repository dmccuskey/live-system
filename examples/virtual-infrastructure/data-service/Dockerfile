# The demo's data service. Build from the repository's root:
#   docker build -f examples/virtual-infrastructure/data-service/Dockerfile -t virtual-infrastructure-data-service .
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
RUN bun install --frozen-lockfile --production --filter @virtual-infrastructure/data-service

COPY packages packages
COPY examples/virtual-infrastructure/protocol examples/virtual-infrastructure/protocol
COPY examples/virtual-infrastructure/data-service examples/virtual-infrastructure/data-service

# The records: mount a tmpfs here for a database that a recreate wipes
RUN mkdir /data && chown bun:bun /data
ENV DATA_SERVICE_DB=/data/virtual-infrastructure.sqlite

USER bun
WORKDIR /app/examples/virtual-infrastructure/data-service
EXPOSE 3030
CMD ["bun", "src/main.ts"]
