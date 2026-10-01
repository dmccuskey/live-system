# Development

LiveSystem is at the design stage. The design is in [Architecture](architecture.md), and the reasons behind it are in the [decision records](decisions/). This page will gain the build, test and branch workflow when the workspace is scaffolded.

## Possible Future Changes

These are ideas, not plans. Each needs discussion and a concrete use case before it is worked on.

- **Reconnecting to the data service.** A connection lost after startup means missed changes. The startup sync ([ADR 008](decisions/008-startup-sync.md)) would have to run again on reconnecting.
- **Other record sources.** An in-memory implementation and others beside Feathers ([ADR 006](decisions/006-record-source-boundary.md)).
- **Authentication and permissions.** Out of scope for now ([ADR 013](decisions/013-server-web-symmetry.md)).
- **Typed payloads per route.** A command's data typed by its route ([ADR 009](decisions/009-commands-events-crud.md)).
- **A shared scheduling helper.** Only once several owners need the same thing ([ADR 015](decisions/015-timers-belong-to-owner.md)).
- **Generated protocol types**, from a schema or an API description ([ADR 010](decisions/010-applications-own-protocol.md)).
- **A devtools package** for inspecting a running system.
- **Docker images for the demo**, started with one command.
- **More examples.** A factory or warehouse simulator, and an application built in its own repository on the published packages.
