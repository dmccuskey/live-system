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
- `connect()` resolves once connected and rejects when the data service can't be reached, or keeps trying until it can.
- Record sources can be taken, and listeners attached, before `connect()`.
- `find()` always returns an array of every record, whether the service returns pages, an array or a single record.
- A paginated service is read page after page by `find()`, or one page at a time, with its total, by `findPage()`.
- Each subscription returns a function that ends it.
- A record's `id` is always a string, also from a service with number IDs.
- A backend that names its ID otherwise (`_id`) is converted with `idField`, and any other shape of record with `convert`.
- A failed call rejects with Feathers' own error, unchanged.
- Logging in with any strategy of the data service, and logging in again by itself each time the connection is made anew.
- A `FeathersRecordSource` satisfies LiveSystem's [`RecordSource`](../../docs/architecture.md#data-and-record-sources), with no dependency on LiveSystem.

It has no REST transport, it keeps no token beyond the connection's life, and it does not load records on its own or load them again after a lost connection. The data service must publish its events to the connection (Feathers [channels](https://feathersjs.com/api/channels.html)), or the listeners hear nothing.

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

|                                                                                                   |                                                 |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| [`new FeathersConnection(options)`](#feathersconnection)                                          | creates a connection, not yet connected         |
| [`await connection.connect()`](#connect)                                                          | connects to the data service                    |
| [`await connection.disconnect()`](#disconnect)                                                    | closes the connection                           |
| [`connection.isConnected`](#isconnected)                                                          | whether the connection is made                  |
| [`connection.onConnected(listener)`, `onDisconnected(listener)`](#onconnected-and-ondisconnected) | hear the connection being made and ending       |
| [`connection.onReconnected(listener)`](#onreconnected)                                            | hear the connection being made again            |
| [`connection.onConnectError(listener)`](#onconnecterror)                                          | hear why an attempt to connect failed           |
| [`await connection.authenticate(request)`](#authenticate)                                         | logs in to the data service                     |
| [`await connection.logout()`](#logout)                                                            | logs out                                        |
| [`connection.isAuthenticated`, `connection.user`](#isauthenticated-and-user)                      | whether the connection is logged in, and as who |
| [`connection.onAuthenticated(listener)`](#onauthenticated)                                        | hear each login                                 |
| [`connection.onAuthenticationLost(listener)`](#onauthenticationlost)                              | hear the login being lost                       |
| [`connection.recordSource<T>(path, options?)`](#recordsource)                                     | a record source over the service at `path`      |
| [`connection.service(path)`](#service)                                                            | the Feathers service at `path`                  |
| [`FeathersRecordSource<T>`](#feathersrecordsource)                                                | the CRUD calls and change events of one service |

### FeathersConnection

```ts
new FeathersConnection({
    url: 'http://localhost:3030',
    connectTimeout: 5000,
    keepTrying: false,
    requestTimeout: 10000,
    handshake: { token: 'a secret' },
    authentication: { path: 'authentication' },
})
```

- `url`: the data service's address.
- `connectTimeout`: how long `connect()` waits, in milliseconds. Optional, 5000 by default. It does not apply with `keepTrying`.
- `keepTrying`: whether `connect()` keeps trying until the data service is there, instead of rejecting on the first attempt that fails. Optional, `false` by default. See [connect](#connect).
- `requestTimeout`: how long a call to the data service waits for its answer, in milliseconds. Optional, 10000 by default. See [calls that are not answered](#calls-that-are-not-answered).
- `handshake`: an object sent to the data service each time the connection is made, a reconnect included. It is Socket.IO's `auth`, so the data service reads it from `socket.handshake.auth`, for example to tell one kind of client from another. Optional, nothing by default.
- `authentication.path`: the path of the data service's authentication service, for one that has it elsewhere (`app.use('auth', …)`). Optional, `authentication` by default. Slashes around it do not matter.

Creating a connection does not connect it. `connection.url` is the address it was given.

### connect

`await connection.connect()` resolves once the socket is connected. It rejects, with an `Error` naming the address and the reason, on the first connection error or when `connectTimeout` passes, and the connection then stops trying. Calling it on a connected connection resolves at once.

With `keepTrying`, an attempt that fails does not reject it, and `connectTimeout` does not apply: it resolves at the first attempt that succeeds, however long that takes. This suits an app that starts before its data service, or without it:

```ts
const connection = new FeathersConnection({ url: 'http://localhost:3030', keepTrying: true })

connection.onConnectError(error => console.log(error.message))
await connection.connect()
```

socket.io paces the attempts, so the app adds no timer: the second comes about a second after the first, each wait is twice as long as the one before, up to five seconds, and each is varied by up to half at random. An attempt that gets no answer at all (an address that answers nothing) is ended by socket.io's own timeout of 20 seconds, which is not `connectTimeout`: the first `onConnectError` may then come that late, with the reason `timeout`. A connection that was logged in logs in again once it is made, and a call made meanwhile waits for no longer than `requestTimeout` (see [calls that are not answered](#calls-that-are-not-answered)).

Even with `keepTrying`, `connect()` rejects when the data service itself refuses the connection (a Socket.IO middleware that answers with an error), since socket.io does not try that again.

`disconnect()` before `connect()` has settled rejects it, with or without `keepTrying`, and ends the trying.

### disconnect

`await connection.disconnect()` closes the socket, and ends a `connect()` that is still trying, which rejects. The connection can be connected again with `connect()`, and the listeners on its record sources stay attached.

### isConnected

`true` while the socket is connected. It turns `false` when the connection is lost as well as when it is closed.

### onConnected and onDisconnected

```ts
const unsubscribe = connection.onDisconnected(() => console.log('lost the data service'))
```

`onConnected` is called each time the connection is made, including when socket.io brings a lost connection back. `onDisconnected` is called each time it ends, whether lost or closed. Each returns a function that ends the subscription.

### onReconnected

```ts
const unsubscribe = connection.onReconnected(() => console.log('the data service is back'))
```

Called each time the connection is made after the first: when socket.io brings a lost connection back, and on `connect()` after `disconnect()`. It is called after the `onConnected` listeners.

A connection that was logged in logs in again first, so a listener's calls are made as the same user. When the login is lost instead, the listeners are held back until `authenticate()` succeeds. See [logging in again](#logging-in-again).

Changes made while the connection was away are not replayed, so records read earlier may be out of date: read them again here. A record source of the connection passes this on as its own `onReconnected`, which is what a LiveSystem `DataManager` listens to.

### onConnectError

```ts
const unsubscribe = connection.onConnectError(error => console.log(error.message))
```

Called with an `Error` each time an attempt to connect fails: the attempt of `connect()`, each one after it with `keepTrying`, and each of socket.io's attempts to bring a lost connection back. The error names the address and the reason, as the one `connect()` rejects with, and its `cause` is socket.io's own error. It is not called when `connectTimeout` passes, which is no attempt that failed: `connect()` rejects, and that is all.

### authenticate

```ts
await connection.authenticate({ strategy: 'local', email: 'ada@example.com', password: 'secret' })
await connection.authenticate({ strategy: 'jwt', accessToken: 'eyJhbGciOi…' })
```

Logs in to the data service, with any request its authentication takes: the `local` strategy with the server's own field names, `jwt` with a token from elsewhere, or a strategy of the server's own. It resolves with the data service's answer (`accessToken`, `authentication`, and the record logged in as), and rejects with its error, a `NotAuthenticated` with `code` 401 when the login is refused. A refused login leaves an earlier one as it is.

The request is sent to the data service's authentication service, at `authentication` unless the connection was given [another path](#feathersconnection). The token of the answer is kept in memory, for [logging in again](#logging-in-again), and nowhere else: a new connection, or a page loaded again, starts logged out. The password is never kept.

Calls made while a login is under way wait for it. `authenticate()` may be called before `connect()`: it is sent as the connection is made.

### logout

`await connection.logout()` forgets the token and the user, and has the data service take the login off the connection. The connection stays connected, and no longer logs in again. Without a login it does nothing.

### isAuthenticated and user

`connection.isAuthenticated` is `true` while this connection is logged in. It turns `false` when the connection ends, until the connection is back and has logged in again.

`connection.user` is the `user` of the login's answer: the record logged in as, where the data service's entity is `user`. It is kept while the connection is away, and is `undefined` after `logout()` and after a lost login.

### onAuthenticated

```ts
const unsubscribe = connection.onAuthenticated(() => console.log('logged in as', connection.user?.email))
```

Called each time a login succeeds: after `authenticate()`, and each time the connection has [logged in again](#logging-in-again).

### onAuthenticationLost

```ts
const unsubscribe = connection.onAuthenticationLost(error => showLogin(error.message))
```

Called with the error when the login is lost:

- the data service refused to log in again with the kept token, for example because the token has run out
- a call was refused as not authenticated (`code` 401) while the connection held itself logged in

The connection has then forgotten the token and the user, and stays connected. The application logs in again with `authenticate()`, or asks the user. A token cannot be renewed: logging in with a token returns the same token, so a session lasts as long as its token, a day by Feathers' default.

A refused `authenticate()` is not a lost login: it rejects, and nothing is called.

#### Logging In Again

A login belongs to the socket, so a new socket is not logged in. Each time the connection is made while a token is kept, the connection logs in with it (the `jwt` strategy) before anything else is sent:

1. The `onConnected` listeners are called, as the socket connects.
2. The login is sent. Calls made since the connection ended wait for it, for no longer than `requestTimeout` each.
3. The login is answered: `isAuthenticated` is `true`, the `onAuthenticated` listeners are called, then the `onReconnected` listeners.

When the data service refuses the token, the `onAuthenticationLost` listeners are called instead, and the `onReconnected` listeners wait until `authenticate()` succeeds. They are called then, since changes were missed meanwhile.

A login that fails otherwise (it is not answered, the connection is lost again) says nothing about the token: nothing is called, and the login is sent again the next time the connection is made. Until then calls wait and reject after `requestTimeout`.

#### A Token That Runs Out

When a token runs out, a Feathers data service closes the socket of its login. The connection then connects again by itself, although socket.io does not bring back a socket the server closed. Its token is refused, and that is the lost login: `onDisconnected`, `onConnected`, `onAuthenticationLost`. The connection is connected and logged out.

For a data service that leaves the socket open, the connection has a timer of its own: two seconds after the token's expiry (`authentication.payload.exp` of the login's answer), it calls the `onAuthenticationLost` listeners itself. The timer goes by the client's clock.

### recordSource

```ts
connection.recordSource<Message>('messages')
connection.recordSource<Message>('messages', { idField: '_id' })
```

Returns a [`FeathersRecordSource<T>`](#feathersrecordsource) over the service at `path`. The record type `T` must have a string `id`. The options:

- `idField`: the backend's name for the record ID, when it is not `id`. Records come back with `id` instead of that field, and go out with that field instead of `id`. `find()` sorts and pages by it, see [paginated services](#paginated-services).
- `convert`: replaces the default conversion of a record, for a record type that is not the backend's record with its ID renamed. See [records and their IDs](#records-and-their-ids). With `convert`, `idField` only names the backend's ID field for `find()`'s paging.
- `onEventError`: called when the record of a change event cannot be converted, see [records and their IDs](#records-and-their-ids). Logs with `console.error` by default.

Each call returns a new record source. They share the connection.

### service

`connection.service(path)` returns the Feathers client's service, for what a record source does not offer, such as every record that matches a query.

### FeathersRecordSource

|                                                                                            |                                                                                                      |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `find(): Promise<T[]>`                                                                     | every record, in ID order, see [paginated services](#paginated-services)                             |
| `findPage({ query?, limit, skip? }): Promise<RecordPage<T>>`                               | one page of the records and how many there are in all, see [one page at a time](#one-page-at-a-time) |
| `get(id): Promise<T>`                                                                      | one record; rejects when it does not exist                                                           |
| `isNotFound(error): boolean`                                                               | whether what a call rejected with is Feathers' `NotFound`: the record does not exist                 |
| `create(data): Promise<T>`                                                                 | creates a record; `data` may leave out `id`, and the data service then assigns one                   |
| `update(id, data): Promise<T>`                                                             | replaces a record                                                                                    |
| `patch(id, data): Promise<T>`                                                              | changes some fields of a record                                                                      |
| `remove(id): Promise<T>`                                                                   | removes a record and returns it                                                                      |
| `onCreated(listener)`, `onUpdated(listener)`, `onPatched(listener)`, `onRemoved(listener)` | hear a change, made by any client; each returns a function that ends the subscription                |
| `onReconnected(listener)`                                                                  | hear the connection being made again after it was lost, see [onReconnected](#onreconnected)          |

A call that fails rejects with Feathers' error as it arrived: a missing record gives an error with the `name` `'NotFound'` and the `code` `404`.

#### Records and Their IDs

A record is the backend's record, as a plain object, with its ID under `id` and as a string:

- **A number ID becomes a string.** A SQL service gives `{ id: 5 }`, and the record source hands on `{ id: '5' }`. The calls take the string: `get('5')`, `patch('5', data)`. Feathers' SQL adapter finds the row by it (checked with `@feathersjs/knex` on SQLite).
- **Another ID field is renamed,** with `idField`: `{ _id: 'a' }` comes back as `{ id: 'a' }`, and goes out as `{ _id: 'a' }`.
- **A record with no ID** is handed on as it is.

A backend record that has a field `id` of its own beside its ID field (`{ _id: 'a', id: 'its own' }`) cannot be renamed without losing that field. The record source refuses it: the call rejects with an error that names the two fields. Use `convert` for such a service.

`convert` replaces all of the above with two functions of your own:

```ts
interface Document {
    id: string
    raw: Record<string, unknown> // the record as the service has it
}

const documents = connection.recordSource<Document>('documents', {
    convert: {
        read: backend => ({ id: String(backend._id), raw: backend }),
        write: data => data.raw ?? {},
    },
})

await documents.patch('5', { raw: { title: 'New' } }) // sends { title: 'New' }
```

- `read(backend)` makes a record of what the service gave. It is called for every record that comes in: from `find()` and `get()`, as the answer of a `create()`, `update()`, `patch()` or `remove()`, and with each change event. Its `id` must be a string, since nothing converts it afterwards.
- `write(data)` makes what the service is sent, from the data of a `create()`, an `update()` or a `patch()`. For a patch it gets a part of a record, so it must not expect every field.
- The IDs given to `get()`, `update()`, `patch()` and `remove()` go to the service as they are.
- For a paginated service whose ID field is not `id`, give `idField` too: `find()` pages by the backend's ID field, which `convert` does not tell it. `idField` then names that field and nothing more: `read` still makes the ID.

When a conversion fails, by the refusal above or by an error your `read` throws, a call rejects with that error. A change event has no caller to reject to, so the event is not delivered to its listeners, and `onEventError` is called with the error. By default that logs it with `console.error`, with the service's path. The record is then missing from what the listeners heard, until the records are read again.

#### Paginated Services

From a service that returns pages, `find()` reads one page after another and returns them as one array. It sorts by the ID field (`$sort`), and asks for each page after the first by the IDs greater than the last one read (`$gt`), until a page holds every record its query counts (`total`). A service that does not count is read until a page is not full. An empty page ends the reading in either case. The records come in ID order, also from a service that does not paginate.

The pages are separate calls, so the result is not a snapshot of one moment. Since each page begins after an ID rather than at a position, a record created or removed while they are read does not move the others: every record that exists throughout the reading is in the result once. One created or removed meanwhile may be in it or not, and its change event reports it, as always.

This needs a service that knows `$sort` and `$gt` on its ID field, which every service on a Feathers database adapter does. A service with a query schema must list the ID field among its queryable properties (in `querySyntax`): otherwise it refuses the paging, and `find()` rejects with the server's `BadRequest`. If a page repeats records already read (a service that ignores `$gt`), or a record has no ID field to page by, `find()` rejects rather than read forever.

#### One Page at a Time

`findPage()` reads a part of the records, for a service too large to read whole and for a query that changes from call to call:

```ts
const page = await messages.findPage({
    query: { channel: 'general', $sort: { createdAt: -1 } },
    limit: 25,
    skip: 50,
})

page.records // up to 25 messages
page.total // how many the query matches in all
```

- `query`: a Feathers query for this call: fields to narrow by, and `$sort` and `$select`. Optional.
- `limit`: how many records at most. With 0 there are none, and the answer is the number of records alone.
- `skip`: how many records to pass over first. Optional, 0 by default.

`findPage()` sets `$limit` and `$skip` itself: one in the call's query is ignored.

It resolves with:

- `records`: the records of the page, converted as every record is.
- `total`: how many records the query matches in all, or `undefined` when the service did not say.
- `limit` and `skip`: the ones the service applied. A service has a maximum of its own, so `limit` may be lower than the one asked for: go on to the next page by the answer, not by the request.

`findPage()` needs a service that knows `$limit` and `$skip`, which every service on a Feathers database adapter does. Feathers itself gives a query no meaning, so a service written by hand may make of them what it likes. What the answer tells you:

| the service                                   | answers                                                                                      | `total`     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------- |
| paginates                                     | a page                                                                                       | a number    |
| is on a database adapter, with pagination off | the records asked for, as an array                                                           | `undefined` |
| does not know `$limit` and `$skip`            | whatever it makes of them: every record, or none. One that checks its query rejects the call | `undefined` |

So a `total` is the only sign that the service paged. Without one, `limit` and `skip` are the ones asked for, an empty `records` cannot be told from a query the service did not understand, and a `limit` of 0 counts nothing. `findPage()` does not guess which kind of service it has: an application that must know asks for the count first, and reads with `find()` where there is none.

Two pages are two calls: a record created or removed between them moves the records behind it, since `findPage()` pages by position.

#### Calls That Are Not Answered

A call that gets no answer rejects with an `Error`, so nothing waits for the data service forever:

| the call                                 | rejects                                                       |
| ---------------------------------------- | ------------------------------------------------------------- |
| is not answered within `requestTimeout`  | then, with `operation has timed out`                          |
| is under way when the connection is lost | at once, with `socket has been disconnected`                  |
| is made while the connection is away     | after `requestTimeout`, unless the connection is back by then |

A call made while the connection is away is held, and sent once the connection is back, before `onReconnected` is called. On a connection that is logged in, it is sent after the connection has [logged in again](#logging-in-again). After `requestTimeout` it is rejected and no longer sent. A write that was under way when the connection was lost may have been made all the same: the data service had it, and only its answer was lost.

A listener hears the changes the data service publishes to this connection, including those this client made itself. The same function subscribed twice is two subscriptions.

The change events are never narrowed by a query: not by the query of a `findPage()` call. A listener hears every change of the service that the data service publishes to this connection, also of a record no call of this source would return. Which changes those are is the data service's doing (its channels).

A record source can also be made directly, over any object with the Feathers service methods and `on` and `off` (the exported type `FeathersServiceLike`), which is how it is tested without a socket:

```ts
new FeathersRecordSource<Message>(service, { idField: '_id' })
```

Made this way it has no connection to hear from, so its `onReconnected` listeners are never called unless the `onReconnected` option says how to subscribe.

## License

MIT, as the [LiveSystem repository](../../LICENSE).
