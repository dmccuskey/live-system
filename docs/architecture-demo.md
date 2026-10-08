# LiveSystem Demo Architecture

The design of the demonstration application in the LiveSystem repository. It is built on the primitives described in [Architecture](architecture.md): read that first.

## Overview

The demo is a **Virtual Infrastructure Simulator**.

Its purpose is not to model real cloud infrastructure accurately. Its purpose is to demonstrate the LiveSystem architecture through a continuously operating system.

The simulator contains two primary domains:

```text
Virtual Infrastructure
│
├── Users
└── Servers
```

## Users

Virtual users continuously generate commands.

Each user has a fixed behavioral profile:

```ts
interface VirtualUserProfile {
    commandsPerMinute: number

    commandMix: {
        search: number
        standard: number
        agentic: number
    }
}
```

The profile is generated when the user is created.

The Demo User can add or remove users but does not directly manipulate their generated behavioral characteristics in the initial version.

This intentional variability creates an unpredictable workload.

For example:

```text
Search
    low resource consumption
    short duration

Standard
    moderate resource consumption
    moderate duration

Agentic
    high resource consumption
    long duration
```

The system therefore produces changing infrastructure conditions without requiring the Demo User to manually generate every workload event.

## Virtual Users as Live Objects

A virtual user is an autonomous live object.

Its behavior includes:

```text
generate commands
       ↓
submit commands
       ↓
observe completion
       ↓
measure unmet demand
       ↓
update frustration
```

The UserManager owns the user's existence.

The User object owns the user's ongoing behavior.

This makes the simulator a concrete demonstration of LiveSystem's object model.

## Virtual Servers

Servers provide finite resources.

A server exposes:

```text
Capacity, in whole units
Current load
Active commands
```

There is one kind of capacity, not CPU, memory and storage apiece ([The Data Service](#the-data-service)).

Commands are routed to available servers.

Server load changes as commands begin and complete.

The exact resource simulation should remain deliberately simple and understandable.

The goal is to demonstrate dynamic behavior rather than create a production-grade infrastructure simulator.

## Server Management

The ServerManager supports two modes.

### Automatic

The ServerManager monitors infrastructure utilization and adds or removes servers according to a scaling policy.

The Demo User configures a maximum utilization threshold.

For example:

```text
Maximum utilization: 75%
```

If sustained utilization exceeds the threshold, the manager adds capacity.

If utilization remains sufficiently below the threshold, the manager may remove excess capacity.

Scale-up and scale-down thresholds should use hysteresis so that the system does not rapidly oscillate between adding and removing servers.

The exact values are configuration rather than architectural requirements.

The Demo User sets one value, the maximum utilization, from 30% to 95%.

The manager samples the servers once a second, in either mode: the load and the capacity of the servers that take commands, and the cost of the commands that wait for room. The load and what waits are the demand. The **utilization** is the average demand of the last 10 seconds over the capacity there is now, and never more than 100%. So a server added or removed shows in it at once, and a change of the load gradually. With no server that takes commands it is 100%.

This one value is what the page shows and what automatic scaling goes by. Scaling keeps it in a band around the maximum, from 15 points below to 5 points above:

| Decision        | When                                                             | Wait after a decision |
| --------------- | ---------------------------------------------------------------- | --------------------- |
| Add a server    | the utilization is above the band                                | 5 s                   |
| Remove a server | the utilization is below the band, and no command waits for room | 15 s                  |

The band is narrow on purpose: the demo is to move, with servers coming and going as the load does, rather than settle. With a maximum of 70% the band is 55% to 75%. With few servers a removal can push the utilization above the band and bring on an addition, at most one round every 20 s or so; the waits keep that from going faster.

Commands that wait for room are demand, because the load stops at the capacity and the queue is what shows demand beyond it. The decision goes by the demand beyond the capacity too, though the utilization shown stops at 100%, so that a maximum of 95% still adds servers. A command that waits for its own user's running commands is not counted: a further server would not start it.

A change to automatic mode counts as a decision: the first one waits its time. Automatic scaling keeps from 1 to 8 servers. Manual mode has no such limit, so a change to automatic mode may find more: at the next sample those beyond 8 leave together, the least loaded first, each removed if idle and drained if not.

Scaling down aborts nothing. An idle server is removed at once, the newest first. With none idle, the least loaded server is drained: it takes no new command, and is removed when its last one ends. Only one server leaves at a time. If more capacity is needed while a server drains, that server is taken back instead of a new one being added.

In automatic mode the add and remove commands are refused, with the error code `automatic_mode`.

### Manual

The Demo User controls the server population directly.

The UI provides:

```text
+ Add Server
- Remove Server
```

The user can therefore observe server utilization and decide when additional capacity is required.

A server removed by hand goes at once, and the commands it runs are aborted. A server that was draining when the mode changed to manual finishes draining.

The underlying server objects and command processing remain identical in both modes.

The difference is simply who makes the scaling decision.

## User Frustration

The simulator should model user experience rather than treating server utilization as the only important metric.

A user's frustration is a fraction from 0 to 1, kept in its record. It moves only with what becomes of the user's commands: bad outcomes add to it, and completed commands relieve it.

| Outcome                                             | Event                                  | Effect on frustration                                                       |
| --------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| Refused, the user already has a command waiting     | `commandRefused` with `queue_full`     | adds 0.05                                                                   |
| Waited in the queue                                 | `commandQueued`, then `commandStarted` | adds 0.01 for each second waited, once, when a server takes the command     |
| Aborted, its server went away under it              | `commandFinished` with `aborted`       | adds 0.05, plus 0.15 times the fraction of its duration the command had run |
| Completed                                           | `commandFinished` with `completed`     | multiplies it by 0.9                                                        |
| Dropped, the user was removed or the system stopped | `commandRefused` with `dropped`        | none, and its wait counts as nothing                                        |

An abort weighs more than a refusal: the user waited and then lost the work. The longer the command had run, the more was lost.

Relief comes from being served, never from time passing:

- A busy user recovers faster than a quiet one. About 7 completed commands halve the frustration.
- A user that is not being served does not calm down: with nothing completing, the frustration stays where it is.
- A command still waiting adds nothing yet. Its user shows frustration meanwhile, because a user may have only one command waiting and its further ones are refused.

The `VirtualUser` does the counting. It listens on the event bus for the outcomes of its own commands, keeps the value in memory, and writes it to its record through `debouncePatch`. Waits and run times are measured on the context's clock. No command outlives the live server, so at startup each user's frustration is reset to 0.

The numbers are placeholders, in the protocol's `users/users.constants.ts`, and the arithmetic is in the live server's `frustration.ts`.

Frustration is therefore an emergent property of the system rather than a manually controlled variable.

This allows the demo to show that infrastructure health and user experience are related but not identical.

## The Data Service

The data service is a Feathers app in a process of its own, with a service per kind of record: `users`, `servers`, `settings` and `status`. The live server and the web app both connect to it over Socket.IO, and it publishes every change to every client.

It keeps the records in a SQLite file, one table per service, each record stored whole as JSON beside its ID. A record therefore gains a field without a change to the table. A record created without an `id` is given a UUID.

The record types are in the demo's protocol:

```ts
interface UserRecord {
    id: string
    name: string
    commandsPerMinute: number
    commandMix: { search: number; standard: number; agentic: number }
    frustration: number
}

interface ServerRecord {
    id: string
    name: string
    capacity: number
    load: number
    activeCommands: number
    isDraining: boolean
}

interface SettingsRecord {
    id: string
    key: string
    scalingMode: 'automatic' | 'manual'
    maxUtilization: number
}

interface StatusRecord {
    id: string
    key: string
    queueLength: number
    waitingForRoom: number
    utilization: number
}
```

A user's command mix is three fractions that sum to 1, and its frustration runs from 0 to 1.

A server has one kind of capacity, counted in whole units, and a command costs a whole number of them. For example, a server of 10 units running one agentic command that costs 4 has a load of 4. Whole numbers are easier to reconcile by eye than fractions of a server.

A settings record belongs to one manager, and its `key` names that manager. There is one so far, with the key `servers`, for the `ServerManager`: the scaling mode and the maximum utilization, a fraction. A manager that gains settings gets a record of its own.

A status record holds what one manager reports of itself, and its `key` names that manager, the one that provides the data. There is one so far, with the key `servers`, for the `ServerManager`: the number of commands that wait in the queue, how many of them wait for room on a server (the others wait for their own user, who has as many running as a user may), and the system utilization, which is the 10-second average that automatic scaling goes by ([Automatic](#automatic)), a fraction from 0 to 1 in whole percent. A manager that gains a status gets a record of its own.

Both kinds of record are found by their `key`, never by their `id`: the ID is the data service's to give, as for every other record.

The service does not validate what it is given: only the live server writes to it.

## The Live Server

The live server is a process of its own: a `LiveSystem` with a `ServerManager`, a `UserManager`, a `SettingsManager` and a `StatusManager`, connected to the data service and taking commands over HTTP. It is the only writer of records.

There are two ways in, and they are kept apart:

```text
Demo User (UI)                         Virtual users (live objects)
      │                                        │
      │ commands, over HTTP                    │ events
      ▼                                        ▼
   Router                                  Event bus
      │                                        │
      ▼                                        ▼
UserManager, ServerManager              ServerManager ──▶ a VirtualServer
```

**Routes are for what the Demo User changes.** There are five, each with a command creator in the protocol:

| Route                  | Does                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `users/add`            | creates a user, with the next free name and a random profile                                          |
| `users/:id/remove`     | removes the user                                                                                      |
| `servers/add`          | creates a server of 10 capacity units                                                                 |
| `servers/:id/remove`   | removes the server                                                                                    |
| `settings/:key/update` | changes the settings of the manager the key names: the scaling mode, the maximum utilization, or both |

The two server routes are refused in automatic mode.

**What the virtual users generate travels over the event bus.** A user and a server never know each other, and nothing calls a manager directly. The events are defined in the protocol's `events.ts`:

| Event                        | Emitted by                       | Means                                                                                                                                                                 |
| ---------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commandRequested`           | a `VirtualUser`                  | the user wants a command run. It carries the command's ID, the user's ID and the type                                                                                 |
| `commandQueued`              | the `ServerManager`              | the command waits in the queue                                                                                                                                        |
| `commandStarted`             | the `VirtualServer` that took it | the command is running, and on which server                                                                                                                           |
| `commandRefused`             | the `ServerManager`              | the command will not be run, and why: `queue_full` when its user already has one waiting, `dropped` when it was waiting as its user was removed or the system stopped |
| `commandFinished`            | the `VirtualServer`              | the command left its server: `completed` after its duration, or `aborted` because the server was removed or the system stopped                                        |
| `userRemoved`                | the `UserManager`                | a user is gone, so whatever of its waits can be dropped                                                                                                               |
| `servers.queueChanged`       | the `ServerManager`              | the number of commands that wait has changed, or how many of them wait for room                                                                                       |
| `servers.utilizationChanged` | the `ServerManager`              | the average utilization of the servers as a whole has changed                                                                                                         |

An event that reports a manager's own status is named after the manager, as the last two are, so that another manager's status can be told apart from it.

**Time comes from the context's clock.** LiveSystem does not ask for this: the demo does it so that its tests can move the time by hand instead of waiting for it. Every delay of the simulation (a user's pause between commands, a command's duration, the sampling of the load, the delay before a record is written) is set on the `clock` in the context, a `Clock` of `live-system/core` ([Architecture](architecture.md#time)), and the waits and run times are read from it. By default it is real time. `createLiveServer` takes a `timeScale`, which multiplies every delay (0.1 runs the simulation ten times as fast), and a `clock` of its own, which is how a test gives its `FakeClock`.

### Settings and Status

Each kind of record has one manager, and only that manager writes it. The `SettingsManager` owns the settings records and the `StatusManager` the status records. Neither is written for a single record: each holds one record per manager, found by its key ([Architecture](architecture.md#a-record-per-manager)).

**Settings travel through the store, not over the event bus.** Every store is a projection of the data service ([Architecture](architecture.md#sharing-data-the-store-first)), and the settings store is no exception. The `settings/:key/update` route has the `SettingsManager` patch the record in the data service. The change comes back as an event of the service, and the `SettingsManager` writes it into the settings store. The `ServerManager` watches that store for the record with its key, `servers`, and takes its settings from there. The `SettingsManager` sees to it that the record is there before anything starts. Should it be missing all the same, for example deleted by hand in the data service during development, the `ServerManager` uses the defaults.

```text
UI ──▶ settings/servers/update ──▶ SettingsManager ──▶ data service
                                                           │ change event
                                                           ▼
                        ServerManager ◀── watches ── settings store
```

The stores are reached through the context, which holds the Pinia instance beside the event bus.

**Which records there must be is in the protocol.** `DEFAULT_SETTINGS` has the defaults of every settings key, and `INITIAL_STATUS` the status every key begins a run with. In its `init()`, once its records are loaded, each of the two managers goes through its table and creates the record of every key that has none. A new key without an entry in its table is a type error, so a record cannot be forgotten. A created record reaches the store with the data service's event, which may come after the answer to the create, so the `SettingsManager` waits in `init()` until the store has it. The same defaults are what a manager falls back on when its record is missing.

**Status goes the other way.** The `ServerManager` produces the queue's length and the utilization, yet it does not write the status record. It announces the queue's length as `servers.queueChanged` events and the utilization as `servers.utilizationChanged` events, which the `StatusManager` writes to the status record with the key `servers`, changes close together as one write.

The utilization is announced after each sample, when it has changed. It leaves a draining server out, because its capacity is on its way out.

The order the managers are added in does not matter, because each phase has its work ([Architecture](architecture.md#each-phase-has-its-work)). A manager loads its records into its store in `init()`, begins to listen and to watch in `start()`, and acts in `run()`. The `ServerManager` begins to watch the settings store in its `start()`, when every store is loaded, and the virtual users send their first commands in their `run()`.

### How a Command Runs

A `VirtualUser`, once running, emits a `commandRequested` event at its record's rate. The requests are unevenly spaced around that rate, and each one's type is drawn from the user's command mix.

The `ServerManager` listens for the event and gives the command to the server with the most free capacity that can fit its cost. A server's load never exceeds its capacity: with no room anywhere, the command waits in the queue.

### The Queue

The `ServerManager` keeps one queue for all servers, in memory, and serves it from the front each time a command finishes or a server is added.

The order is strict: a command that waits for room keeps everything behind it waiting, even a smaller command that would fit now. Without this, small commands would keep taking the room as it comes free, and a large one could wait forever. With it, every command the queue accepts is run in the end.

Each user has two limits:

| Limit                         | Value | Beyond it                                                             |
| ----------------------------- | ----- | --------------------------------------------------------------------- |
| Commands running at once      | 3     | the next one waits in the queue, until one of the user's own finishes |
| Commands waiting in the queue | 1     | the next one is refused                                               |

A user refused once and refused again on every retry would never be served. The one place in the queue rules this out, and the queue is never longer than the number of users.

Three commands at once are what let a few users load a few servers: a single user can ask for up to 12 units, more than one server has. A command that waits for its own user, not for room, does not hold up the commands behind it.

A refused command is unmet demand, and so is the time a command spends waiting.

A `VirtualServer` keeps its active commands in memory and holds a timer for each. Its record holds only their count and the load they add up to, written shortly after each change, so that changes close together are one write. A restart therefore finds no command running, and each server clears what its record says of the earlier run.

The command types, with placeholder values to be tuned once the demo runs:

| Type     | Cost    | Duration |
| -------- | ------- | -------- |
| search   | 1 unit  | 2 s      |
| standard | 2 units | 5 s      |
| agentic  | 4 units | 15 s     |

### A First Start

With no server record at start, the `ServerManager` creates one, and with no user record the `UserManager` creates one. The `SettingsManager` creates the settings of every key from the protocol's defaults (for `servers`: automatic mode with a maximum utilization of 75%), and the `StatusManager` the status of every key. The system therefore works without any input.

## Demo User Interface

The Demo User interacts primarily with the environment.

Initial controls should include:

```text
Users
    [+ Add User]

Servers
    Mode: [Automatic | Manual]

    Maximum utilization: [slider]

    [In manual mode]
    [+ Add Server]
```

In manual mode each server has a direct remove control too.

Each user has a direct remove control:

```text
Alice                              [-]
Bob                                [-]
Charlie                            [-]
```

The user profile displays:

```text
Alice

Activity:       8 commands/min
Search:         70%
Standard:       20%
Agentic:        10%

Frustration:    14%
```

The command mix is visible but not editable in the initial version.

Later versions may allow the activity rate to be adjusted with a slider.

The command mix should remain fixed initially so that changing infrastructure produces interesting behavior without giving the Demo User direct control over every variable.

### The Web App

The web app is in Vue 3, and built like the live server: a `LiveSystem`, a connection to the data service, and a manager per kind of record that mirrors its service into a Pinia store ([Processes, Server and Web](architecture.md#processes-server-and-web)). It has no router and no live objects, and its managers do nothing beyond the mirroring: each is an empty `DataManager`.

```text
Data service ──▶ UserManager, ServerManager,     ──▶ stores ──▶ components
                 SettingsManager, StatusManager                      │
                                                                     │ commands
Live server ◀── dev server (/command) ◀── CommandClient ◀────────────┘
```

A component reads the stores and sends commands, and nothing else. It changes nothing on the page by itself: a new user appears when its record arrives, and the mode shown is the settings record's. The one exception is the slider, which shows its own value from the first movement until the record has the change. It sends its command when released, not on every movement.

The page is mounted at once and renders from three things ([Starting a Web App](architecture.md#starting-a-web-app)):

| What              | Shown as                                                                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| System status     | a loading line while starting, the reason when the startup failed, the panels when running                                                                                                                                                             |
| Connection status | a warning above the panels while the data service is not connected                                                                                                                                                                                     |
| Records           | the panels: a card per user and per server, the mode and the maximum utilization from the settings record, the utilization and the command queue from the status record, as the commands that wait for their own user and those that wait for capacity |

The utilization jumps with every command that starts or ends, so the status record holds its average over 10 seconds, which the live server keeps and automatic scaling goes by ([Automatic](#automatic)). The page shows it as it is: every browser sees the same value. In automatic mode it is shown in red while it is above the maximum utilization.

A user's frustration bar is green below 25%, yellow below 50%, orange below 75% and red from there on.

The settings and the status are found by their key, `servers`. While a record is missing, the protocol's defaults are shown.

In manual mode the panel has the add control and each server a remove control, and the slider is disabled. In automatic mode neither control is there. A server that is draining says so.

A command that fails, for example one refused with `automatic_mode` because another browser changed the mode meanwhile, is shown as a notice at the top, which goes away after a few seconds.

## Demonstration Goals

The demo should make several architectural properties observable.

### Autonomous Behavior

The system continues doing work even when the Demo User does nothing.

### Dynamic Object Creation

Users and servers can appear and disappear while the system is running.

### Long-Lived State

Objects maintain state across many interactions.

### Event-Driven Behavior

Changes in one part of the system cause other components to react.

### Command Routing

Generated commands are routed to available resources.

### Resource Constraints

Finite server capacity affects system behavior.

### Autonomous Management

The ServerManager can observe conditions and make scaling decisions.

### Emergent Behavior

Randomized user activity and differing command costs create changing conditions.

### Reactive Presentation

The UI continuously reflects the state of the running system.
