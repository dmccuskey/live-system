# ADR 012: One Bun Workspace With a Demo That Uses the Real Packages

**Status:** Accepted

## Context

LiveSystem needs a home for its code and a way to prove the design works. A framework developed without an application drifts toward abstractions nobody needs; a demo that fakes the framework proves nothing.

The first application considered was a trading system, which needs market data and an account before anything runs.

## Decision

**One repository, a Bun workspace:**

```text
live-system/
├── packages/
│   ├── live-system/        core, server and web entry points
│   ├── micro-fsm/          the state machine
│   └── feathers-connect/   the Feathers connection and record sources
└── examples/
    └── virtual-infrastructure/
```

- `live-system` is one package with three entry points. `core` holds what both sides share: the lifecycle, `BaseManager`, `DataManager<T>`, `RecordSource` and the optional event bus. `server` holds the router and the `CommandServer`, which turns an HTTP request into a command. `web` holds the `CommandClient` and the web startup.
- `micro-fsm` ([ADR 004](004-lifecycle-runner-and-state-machine.md)) and `feathers-connect` ([ADR 006](006-record-source-boundary.md)) start in this workspace and are built to move to repositories of their own.

**A running system is three processes at least:** the data service (Feathers with SQLite), the live server, and a web app. The live server and every web app are clients of the data service. A system may have several web apps, all built the same way.

**The demo** is the Virtual Infrastructure Simulator, described in [Demo Architecture](../architecture-demo.md).

- It uses the real packages, never stand-ins written for the demo.
- It is self-contained: no API key and no external service.
- Once started it runs on its own, without anyone driving it.

**Tests from the start**, with `bun test`, as many as possible. Every piece of work brings its tests.

Rejected:

- **Separate packages for the server and web parts.** They are too small to stand alone.
- **A trading application as the first demo.** It cannot run without market data.
- **A separate repository for the demo.** The demo then lags behind the packages it should be proving.
- **A factory or warehouse simulator.** More to build before anything is visible.
- **A task list.** It shows too little: nothing in it is alive.
- **Tests only on request.**

## Consequences

- Every change to a package is exercised by the demo in the same workspace.
- Someone can clone the repository and watch a live system run, with nothing to sign up for.
- The demo's concepts (`VirtualUser`, `VirtualServer`, `UserManager`, `ServerManager`) stay in `examples/`, never in the packages ([ADR 010](010-applications-own-protocol.md)).
- Three processes are more to start than one. The demo needs a single command that starts all three.
