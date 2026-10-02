# ADR 013: Server and Web Are Symmetric Where Possible

**Status:** Accepted

## Context

The live server and a web app do related jobs: both connect to the data service, mirror its records into a store, and react to changes. They differ in that the server owns the live objects and writes records, while a web app displays what is happening and can only ask for changes.

An earlier web prototype had one aggregate data manager. It wrapped every data service, copied their records into the store, and also sent commands by HTTP POST: a separate command manager had been planned, and sending moved into the data manager instead. Commands were built by creator functions kept with the shared protocol, which worked well. UI components called a creator, sent the result, and handled the errors where they called it. Data sync and command transport were mixed in one object, and nothing was shared with the server's managers.

## Decision

**Shared.** The same `BaseManager`, and `DataManager<T>` where it fits, run on both sides, so they live in `core` ([ADR 005](005-manager-capabilities.md), [ADR 012](012-bun-workspace-and-demo.md)).

**The web side:**

- A web app is a display of what happens on the server, seen through the data service. It has managers and no live objects.
- It has one `DataManager` per data service, each mirroring one kind of record into the store, using the same startup sync as the server ([ADR 008](008-startup-sync.md)).
- It never writes records. It changes things only by sending commands ([ADR 007](007-data-service-source-of-truth.md)).
- Commands are built by the application's command creators, which live in its protocol ([ADR 010](010-applications-own-protocol.md)), and sent through a small `CommandClient`, which owns the transport and the error handling and builds no application commands:

  ```ts
  await commands.send(restartServer('42', { force: false }))
  ```

  With one `DataManager` per data service there is no single data manager for sending to belong to, so it has an object of its own.

  `send` resolves with the command's response when the server has accepted it, and rejects with a structured error when it failed ([ADR 014](014-failure-and-shutdown.md)). Results and progress arrive as record changes ([ADR 009](009-commands-events-crud.md)).
- A web app has a startup sequence, smaller than the server's: connect to the data service, then have the data managers load into the store. The app is shown from the beginning, not at the end: it renders from the startup's status (starting, running, failed), kept as reactive state, so it can show a loading screen or the reason for a failure. Whether the connection is up after startup is a separate condition, which the application shows from its connection.

Rejected:

- **One aggregate data manager that also sends commands.** It mixes two jobs and grows with every data service added.
- **Separate manager hierarchies for server and web.** The data managers would be written twice.
- **Showing the app only once startup has finished.** Nothing can be shown while it starts, or when it fails.
- **Transport errors handled in each UI component.** The transport's details spread through the UI. A component still decides what to show when its command fails.

## Consequences

- The data-sync code is written and tested once and used on both sides.
- Adding a data service to a web app means adding one manager.
- A web app has no path to change data except a command, which keeps the server the only writer.
- The symmetry is partial. Live objects, the router and record writes exist only on the server, and the shared classes must not assume them.
- Authentication and permissions are out of scope for now.
