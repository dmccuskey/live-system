# LiveSystem Documentation

New to LiveSystem? Start with the [README](../README.md). The primitives these pages describe are implemented, and the demo runs on them ([Current Baseline](development.md#current-baseline)). Nothing is a published API yet.

## Internals

- [Architecture](architecture.md): the primitives, the lifecycle, managers, live objects, record sources, commands and events, and the package structure
- [Demo Architecture](architecture-demo.md): the Virtual Infrastructure Simulator, the demo application that proves the design
- [Architecture Decisions](decisions/): the decision records (ADRs): why the design is what it is, and what was rejected
- [Micro FSM](../packages/micro-fsm/README.md): the state machine behind the lifecycle, a package of its own: what it does and its reference
- [Feathers Connect](../packages/feathers-connect/README.md): the connection to a Feathers data service and the record sources over its services, a package of its own: what it does and its reference

## Contribute

- [Development](development.md): the current baseline, the design guidelines, how to build and test, the branch workflow, and possible future changes

## Project Structure

```text
live-system/
├── docs/
│   ├── README.md                 # this page
│   ├── architecture.md           # the design of LiveSystem
│   ├── architecture-demo.md      # the design of the demo application
│   ├── development.md            # build, test, and possible future changes
│   └── decisions/                # ADRs
├── packages/
│   ├── live-system/              # the framework: core, server and web entry points
│   ├── micro-fsm/                # the state machine behind the lifecycle
│   └── feathers-connect/         # the Feathers connection and record sources
├── examples/
│   └── virtual-infrastructure/   # the demo application
│       ├── protocol/             # records, routes and commands, by domain
│       ├── data-service/         # Feathers with SQLite
│       ├── live-server/          # managers and live objects
│       ├── web/                  # the web app, in Vue 3
│       └── compose.yaml          # the demo as three containers
├── node_modules/                 # installed by `bun install` (gitignored)
├── .github/workflows/            # publishes the demo's images on a tag
├── .dockerignore                 # what the demo's images leave out
├── .prettierrc                   # the code style, for Prettier
├── bun.lock
├── bunfig.toml                   # preloads what `bun test` needs for `.vue` files
├── package.json                  # the Bun workspace
├── tsconfig.json                 # TypeScript configuration shared by the packages
├── LICENSE
└── README.md
```
