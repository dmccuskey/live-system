# Feathers Connect

A connection to a [Feathers](https://feathersjs.com) data service for TypeScript, and a record source over each of its services.

You make one connection, and take from it a record source for each kind of record. A record source offers the CRUD calls and the change events of one service, with records as plain typed objects.

```ts
import { FeathersConnection } from 'feathers-connect'

interface Message {
    id: string
    text: string
}

const connection = new FeathersConnection({ url: 'http://localhost:3030' })
const messages = connection.recordSource<Message>('messages')

const unsubscribe = messages.onCreated(message => console.log('created:', message.text))

await connection.connect()

await messages.create({ text: 'hello' })
const all = await messages.find() // Message[]

unsubscribe()
await connection.disconnect()
```

## Features

- One socket connection (socket.io), shared by every record source.
- `connect()` resolves once connected and rejects when the data service can't be reached.
- Record sources can be taken, and listeners attached, before `connect()`.
- `find()` always returns an array, whether the service returns a page, an array or a single record.
- Each subscription returns a function that ends it.
- A backend that names its ID otherwise (`_id`) is converted with `idField`.
- A failed call rejects with Feathers' own error, unchanged.
- A `FeathersRecordSource` satisfies LiveSystem's [`RecordSource`](../../docs/architecture.md#data-and-record-sources), with no dependency on LiveSystem.

It has no authentication, no queries beyond a fixed one for `find()`, no REST transport, and it does not load records on its own or load them again after a lost connection. The data service must publish its events to the connection (Feathers [channels](https://feathersjs.com/api/channels.html)), or the listeners hear nothing.

## Quick Start

The following steps take about five minutes, on any system with [Bun](https://bun.sh). You will have a client that creates a record in a data service, hears the change and reads the record back.

Prerequisite: Bun (`bun --version`).

The package is not published yet. It is part of the [LiveSystem](../../README.md) workspace, so the steps run inside a clone of it.

1. In the clone, install the workspace:

    ```sh
    bun install
    ```

2. Save this as `packages/feathers-connect/try.ts`. Its first half is a small data service that keeps its records in memory, so there is something to connect to:

    ```ts
    import { feathers } from '@feathersjs/feathers'
    import { MemoryService } from '@feathersjs/memory'
    import socketio from '@feathersjs/socketio'
    import { FeathersConnection } from 'feathers-connect'

    interface Message {
        id: string
        text: string
    }

    // A data service with one service, 'messages', that publishes every change
    const app = feathers()
    app.configure(socketio())
    app.use('messages', new MemoryService({ id: 'id' }))
    app.on('connection', (peer: any) => (app as any).channel('everyone').join(peer))
    ;(app as any).publish(() => (app as any).channel('everyone'))
    const server = await app.listen(3030)

    // The client
    const connection = new FeathersConnection({ url: 'http://localhost:3030' })
    const messages = connection.recordSource<Message>('messages')

    const unsubscribe = messages.onCreated(message => console.log('created:', message.text))

    await connection.connect()
    await messages.create({ id: 'first-message', text: 'hello' })
    console.log(await messages.find())

    unsubscribe()
    await connection.disconnect()
    await app.teardown()
    server.close()
    ```

3. Run it:

    ```sh
    bun packages/feathers-connect/try.ts
    ```

    ```text
    created: hello
    [
      {
        id: "first-message",
        text: "hello",
      }
    ]
    ```

    `Cannot find package 'feathers-connect'` means step 1 was skipped, or the file is outside the workspace. An error with `EADDRINUSE` means something else is using port 3030: change the port in both places.

Delete `try.ts` when you are done.

## Reference

| | |
|---|---|
| [`new FeathersConnection(options)`](#feathersconnection) | creates a connection, not yet connected |
| [`await connection.connect()`](#connect) | connects to the data service |
| [`await connection.disconnect()`](#disconnect) | closes the connection |
| [`connection.isConnected`](#isconnected) | whether the connection is made |
| [`connection.onConnected(listener)`, `onDisconnected(listener)`](#onconnected-and-ondisconnected) | hear the connection being made and ending |
| [`connection.recordSource<T>(path, options?)`](#recordsource) | a record source over the service at `path` |
| [`connection.service(path)`](#service) | the Feathers service at `path` |
| [`FeathersRecordSource<T>`](#feathersrecordsource) | the CRUD calls and change events of one service |

### FeathersConnection

```ts
new FeathersConnection({
    url: 'http://localhost:3030',
    connectTimeout: 5000
})
```

- `url`: the data service's address.
- `connectTimeout`: how long `connect()` waits, in milliseconds. Optional, 5000 by default.

Creating a connection does not connect it. `connection.url` is the address it was given.

### connect

`await connection.connect()` resolves once the socket is connected. It rejects, with an `Error` naming the address and the reason, on the first connection error or when `connectTimeout` passes, and the connection then stops trying. Calling it on a connected connection resolves at once.

### disconnect

`await connection.disconnect()` closes the socket. The connection can be connected again with `connect()`, and the listeners on its record sources stay attached.

### isConnected

`true` while the socket is connected. It turns `false` when the connection is lost as well as when it is closed.

### onConnected and onDisconnected

```ts
const unsubscribe = connection.onDisconnected(() => console.log('lost the data service'))
```

`onConnected` is called each time the connection is made, including when socket.io brings a lost connection back. `onDisconnected` is called each time it ends, whether lost or closed. Each returns a function that ends the subscription.

Changes made while the connection was lost are not replayed: after `onConnected`, records read earlier may be out of date.

### recordSource

```ts
connection.recordSource<Message>('messages')
connection.recordSource<Message>('messages', { idField: '_id', query: { channel: 'general' } })
```

Returns a [`FeathersRecordSource<T>`](#feathersrecordsource) over the service at `path`. The record type `T` must have a string `id`. The options:

- `idField`: the backend's name for the record ID, when it is not `id`. Records come back with `id` instead of that field, and go out with that field instead of `id`. The value is not converted: a backend with numeric IDs gives numbers.
- `query`: a fixed Feathers query that every `find()` sends, for a source that covers only a part of the service's records.

Each call returns a new record source. They share the connection.

### service

`connection.service(path)` returns the Feathers client's service, for what a record source does not offer, such as a `find` with its own query.

### FeathersRecordSource

| | |
|---|---|
| `find(): Promise<T[]>` | every record, or every record matching the fixed `query` |
| `get(id): Promise<T>` | one record; rejects when it does not exist |
| `create(data): Promise<T>` | creates a record; `data` may leave out `id`, and the data service then assigns one |
| `update(id, data): Promise<T>` | replaces a record |
| `patch(id, data): Promise<T>` | changes some fields of a record |
| `remove(id): Promise<T>` | removes a record and returns it |
| `onCreated(listener)`, `onUpdated(listener)`, `onPatched(listener)`, `onRemoved(listener)` | hear a change, made by any client; each returns a function that ends the subscription |

A call that fails rejects with Feathers' error as it arrived: a missing record gives an error with the `name` `'NotFound'` and the `code` `404`.

A listener hears the changes the data service publishes to this connection, including those this client made itself. The same function subscribed twice is two subscriptions.

A record source can also be made directly, over any object with the Feathers service methods and `on` and `off` (the exported type `FeathersServiceLike`), which is how it is tested without a socket:

```ts
new FeathersRecordSource<Message>(service, { idField: '_id' })
```

## License

MIT, as the [LiveSystem repository](../../LICENSE).
