// FeathersConnection: the one connection to a Feathers data service, shared by every record source.
import { NotAuthenticated } from '@feathersjs/errors'
import { feathers, type Application, type HookContext } from '@feathersjs/feathers'
import socketio from '@feathersjs/socketio-client'
import { io, type Socket } from 'socket.io-client'
import {
    FeathersRecordSource,
    type FeathersRecordSourceOptions,
    type FeathersServiceLike,
    type HasId,
    type Unsubscribe,
} from './record-source.ts'

export interface FeathersConnectionOptions {
    /** The data service's address, for example `http://localhost:3030`. */
    url: string
    /** How long `connect()` waits, in milliseconds. */
    connectTimeout?: number
    /**
     * How long a call to the data service waits for its answer, in
     * milliseconds. A call made while the connection is away is held until
     * the connection is back, for no longer than this.
     */
    requestTimeout?: number
    /**
     * Sent to the data service each time the connection is made, as Socket.IO's
     * `auth`: the data service reads it from `socket.handshake.auth`. Nothing unless given.
     */
    handshake?: Record<string, unknown>
    /** Where the data service has its authentication. */
    authentication?: {
        /** The path of its authentication service. `authentication` unless given. */
        path?: string
    }
}

/**
 * What `authenticate()` sends: any request the data service's authentication
 * takes. The `local` strategy with the server's own field names, or `jwt`
 * with an `accessToken`.
 */
export interface AuthenticationRequest {
    strategy: string
    [field: string]: unknown
}

/** The data service's answer to a login. */
export interface AuthenticationResult {
    accessToken: string
    /** The strategy that logged in and, with Feathers' JWT strategy, the token's payload: `exp` is its expiry in seconds. */
    authentication?: { strategy?: string; payload?: { exp?: number; [claim: string]: unknown } }
    /** The record logged in as, when the data service's entity is `user`. */
    user?: Record<string, unknown>
    [field: string]: unknown
}

type ConnectionListener = () => void
type AuthenticationLostListener = (error: Error) => void

const DEFAULT_CONNECT_TIMEOUT = 5000
const DEFAULT_REQUEST_TIMEOUT = 10_000
const DEFAULT_AUTHENTICATION_PATH = 'authentication'
const NOT_AUTHENTICATED = 401
// How long after a token's expiry the library waits for the data service to close the socket, before it reports the login lost itself
const EXPIRY_GRACE = 2000
// The longest delay a timer takes: a longer one would fire at once
const MAX_TIMER_DELAY = 2 ** 31 - 1

/**
 * A socket connection to a Feathers data service. Services and record sources
 * can be taken from it, and listeners attached to them, before `connect()`:
 * nothing reaches the data service until the connection is made.
 */
export class FeathersConnection {
    #url: string
    #connectTimeout: number
    #requestTimeout: number
    #authenticationPath: string
    #socket: Socket
    #client: Application
    #connectedListeners = new Set<ConnectionListener>()
    #disconnectedListeners = new Set<ConnectionListener>()
    #reconnectedListeners = new Set<ConnectionListener>()
    #authenticatedListeners = new Set<ConnectionListener>()
    #authenticationLostListeners = new Set<AuthenticationLostListener>()
    #hasConnected = false
    // The login: the token is kept to log in again on a new socket, the password never
    #token: string | undefined
    #user: Record<string, unknown> | undefined
    #isAuthenticated = false
    #expiryTimer: ReturnType<typeof setTimeout> | undefined
    // A login is wanted and not yet done: calls wait for it
    #isAwaitingLogin = false
    #loginsUnderWay = 0
    #loginWaiters = new Set<() => void>()
    // The login was refused or ran out, and `authenticate()` has not succeeded since
    #isLoginLost = false
    // Changes were missed, and the `onReconnected` listeners have not been told yet
    #isReconnectedOwed = false

    constructor(options: FeathersConnectionOptions) {
        this.#url = options.url
        this.#connectTimeout = options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT
        this.#requestTimeout = options.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT
        // Without the slashes around it, as Feathers names a service: a hook's `context.path` is compared with it
        this.#authenticationPath = (options.authentication?.path ?? DEFAULT_AUTHENTICATION_PATH).replace(
            /^\/+|\/+$/g,
            '',
        )

        // With an ackTimeout socket.io rejects a call that is not answered in time, and no longer sends one it held
        this.#socket = io(this.#url, {
            transports: ['websocket'],
            autoConnect: false,
            ackTimeout: this.#requestTimeout,
            auth: options.handshake,
        })
        this.#socket.on('connect', () => {
            const isReconnect = this.#hasConnected

            this.#hasConnected = true
            this.#emit(this.#connectedListeners)

            if (isReconnect) this.#isReconnectedOwed = true

            // A login belongs to the socket: a new socket is not logged in
            if (this.#token !== undefined) void this.#logInAgain(this.#token)
            else this.#emitReconnectedIfOwed()
        })
        this.#socket.on('disconnect', reason => {
            const hasLoggedIn = this.#token !== undefined || this.#isLoginLost

            if (this.#token !== undefined) {
                this.#isAuthenticated = false
                this.#isAwaitingLogin = true
                this.#clearExpiryTimer()
            }

            this.#emit(this.#disconnectedListeners)

            // Feathers closes the socket of a login whose token has run out, and socket.io does not
            // bring back a socket the server closed: without this the connection would stay away
            if (reason === 'io server disconnect' && hasLoggedIn && !this.#socket.active) this.#socket.connect()
        })

        this.#client = feathers()
        this.#client.configure(socketio(this.#socket))
        this.#client.hooks({
            before: { all: [(context: HookContext) => this.#waitForLogin(context)] },
            error: { all: [(context: HookContext) => this.#noticeRefusal(context)] },
        })
    }

    get url(): string {
        return this.#url
    }

    get isConnected(): boolean {
        return this.#socket.connected
    }

    /** Whether this connection is logged in. Not while the connection is away, until it has logged in again. */
    get isAuthenticated(): boolean {
        return this.#isAuthenticated
    }

    /** The record logged in as, from the login's answer. `undefined` when not logged in. */
    get user(): Record<string, unknown> | undefined {
        return this.#user
    }

    /**
     * Connects to the data service. Resolves once connected. Rejects on the
     * first connection error or when the timeout passes, and stops trying.
     */
    connect(): Promise<void> {
        if (this.isConnected) return Promise.resolve()

        return new Promise<void>((resolve, reject) => {
            const socket = this.#socket

            const settle = () => {
                clearTimeout(timer)
                socket.off('connect', onConnect)
                socket.off('connect_error', onError)
            }
            const onConnect = () => {
                settle()
                resolve()
            }
            const fail = (reason: string) => {
                settle()
                socket.disconnect()
                reject(new Error(`Could not connect to the data service at ${this.#url}: ${reason}`))
            }
            const onError = (error: Error) => fail(error.message)
            const timer = setTimeout(() => fail(`no connection after ${this.#connectTimeout} ms`), this.#connectTimeout)

            socket.on('connect', onConnect)
            socket.on('connect_error', onError)
            socket.connect()
        })
    }

    /** Closes the connection. It can be connected again. */
    async disconnect(): Promise<void> {
        this.#socket.disconnect()
    }

    /**
     * Logs in to the data service. Resolves with its answer; rejects with its
     * error when the login is refused. The token is kept in memory to log in
     * again each time the connection is made anew, and nothing else is: when
     * the token runs out, the app logs in again.
     */
    async authenticate(request: AuthenticationRequest): Promise<AuthenticationResult> {
        this.#loginsUnderWay++

        try {
            const result = await this.#sendLogin(request)

            this.#loggedIn(result)

            return result
        } finally {
            this.#loginsUnderWay--
            this.#releaseLoginWaiters()
        }
    }

    /**
     * Logs out: the data service takes the login off the connection, and the
     * token is forgotten, also when the data service could not be told.
     */
    async logout(): Promise<void> {
        const isLoggedInThere = this.#isAuthenticated

        this.#isAuthenticated = false
        this.#token = undefined
        this.#user = undefined
        this.#isAwaitingLogin = false
        this.#isLoginLost = false
        this.#isReconnectedOwed = false
        this.#clearExpiryTimer()
        this.#releaseLoginWaiters()

        // Without a login on this socket there is nothing for the data service to take off
        if (isLoggedInThere) await this.#client.service(this.#authenticationPath).remove(null)
    }

    /** The Feathers service at a path, for what a record source does not offer. */
    service(path: string): FeathersServiceLike {
        return this.#client.service(path) as unknown as FeathersServiceLike
    }

    /** A record source over the service at a path. */
    recordSource<T extends HasId>(path: string, options?: FeathersRecordSourceOptions<T>): FeathersRecordSource<T> {
        return new FeathersRecordSource<T>(this.service(path), {
            path,
            ...options,
            onReconnected: listener => this.onReconnected(listener),
        })
    }

    /** Called each time the connection is made, also after a lost connection comes back. */
    onConnected(listener: ConnectionListener): Unsubscribe {
        return this.#on(this.#connectedListeners, listener)
    }

    /**
     * Called each time the connection is made after the first: a lost
     * connection that socket.io brought back, or `connect()` after
     * `disconnect()`. Changes made meanwhile were not heard.
     */
    onReconnected(listener: ConnectionListener): Unsubscribe {
        return this.#on(this.#reconnectedListeners, listener)
    }

    /** Called each time the connection ends, whether lost or closed. */
    onDisconnected(listener: ConnectionListener): Unsubscribe {
        return this.#on(this.#disconnectedListeners, listener)
    }

    /** Called each time a login succeeds: `authenticate()`, and logging in again after the connection is made anew. */
    onAuthenticated(listener: ConnectionListener): Unsubscribe {
        return this.#on(this.#authenticatedListeners, listener)
    }

    /**
     * Called with the error when the login is lost: the data service refused
     * to log in again, the token ran out, or a call was refused as not
     * authenticated. The token is forgotten, and the `onReconnected`
     * listeners are held back until `authenticate()` succeeds.
     */
    onAuthenticationLost(listener: AuthenticationLostListener): Unsubscribe {
        return this.#on(this.#authenticationLostListeners, listener)
    }

    #sendLogin(request: AuthenticationRequest): Promise<AuthenticationResult> {
        return this.#client.service(this.#authenticationPath).create(request) as Promise<AuthenticationResult>
    }

    #loggedIn(result: AuthenticationResult): void {
        this.#token = result.accessToken
        this.#user = result.user
        this.#isAuthenticated = true
        this.#isAwaitingLogin = false
        this.#isLoginLost = false
        this.#setExpiryTimer(result.authentication?.payload?.exp)
        this.#releaseLoginWaiters()
        this.#emit(this.#authenticatedListeners)
        this.#emitReconnectedIfOwed()
    }

    /** Logs in on a new socket with the kept token. */
    async #logInAgain(token: string): Promise<void> {
        const isCurrent = () => this.#token === token && !this.#isAuthenticated

        try {
            const result = await this.#sendLogin({ strategy: 'jwt', accessToken: token })

            // Not when `authenticate()` or `logout()` settled the login meanwhile
            if (isCurrent()) this.#loggedIn(result)
        } catch (error) {
            // Only a refusal says something about the token. Anything else (a timeout, the
            // connection lost again) leaves the login wanted, for the next time the connection is made
            if (isCurrent() && isRefusal(error)) this.#loginLost(error)
        }
    }

    #loginLost(error: Error): void {
        this.#isAuthenticated = false
        this.#token = undefined
        this.#user = undefined
        this.#isAwaitingLogin = false
        this.#isLoginLost = true
        this.#isReconnectedOwed = true
        this.#clearExpiryTimer()
        this.#releaseLoginWaiters()

        for (const listener of [...this.#authenticationLostListeners]) {
            listener(error)
        }
    }

    /** Before every call but a login: holds it while a login is wanted and not yet done, for no longer than `requestTimeout`. */
    async #waitForLogin(context: HookContext): Promise<void> {
        if (context.path === this.#authenticationPath) return

        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('operation has timed out')), this.#requestTimeout)
        })

        try {
            while (this.#isAwaitingLogin || this.#loginsUnderWay > 0) {
                await Promise.race([new Promise<void>(resolve => this.#loginWaiters.add(resolve)), timeout])
            }
        } finally {
            clearTimeout(timer)
        }
    }

    #releaseLoginWaiters(): void {
        const waiters = [...this.#loginWaiters]

        this.#loginWaiters.clear()

        for (const release of waiters) {
            release()
        }
    }

    /** After every failed call but a login: a call refused as not authenticated means the login is gone. */
    #noticeRefusal(context: HookContext): void {
        if (context.path === this.#authenticationPath) return

        if (this.#isAuthenticated && isRefusal(context.error)) this.#loginLost(context.error)
    }

    /**
     * A timer for the token's expiry, as a fallback. Feathers over Socket.IO closes the socket when
     * a token runs out: the connection is made again, the token is refused, and that is the lost
     * login. The timer speaks only when the data service has not closed the socket a while after.
     */
    #setExpiryTimer(expiresAtSeconds: number | undefined): void {
        this.#clearExpiryTimer()

        if (expiresAtSeconds === undefined) return

        const delay = expiresAtSeconds * 1000 + EXPIRY_GRACE - Date.now()

        this.#expiryTimer =
            delay > MAX_TIMER_DELAY
                ? setTimeout(() => this.#setExpiryTimer(expiresAtSeconds), MAX_TIMER_DELAY)
                : setTimeout(() => this.#loginLost(new NotAuthenticated('The access token has expired')), delay)
    }

    #clearExpiryTimer(): void {
        clearTimeout(this.#expiryTimer)
        this.#expiryTimer = undefined
    }

    #emitReconnectedIfOwed(): void {
        if (!this.#isReconnectedOwed || this.#isAwaitingLogin || this.#isLoginLost) return

        this.#isReconnectedOwed = false
        this.#emit(this.#reconnectedListeners)
    }

    #on<L extends (...args: never[]) => void>(listeners: Set<L>, listener: L): Unsubscribe {
        // A wrapper of its own, so the same function subscribed twice is two subscriptions
        const entry = ((...args: never[]) => listener(...args)) as L

        listeners.add(entry)

        return () => {
            listeners.delete(entry)
        }
    }

    #emit(listeners: Set<ConnectionListener>): void {
        for (const listener of [...listeners]) {
            listener()
        }
    }
}

/** Whether an error is the data service's refusal: not authenticated. */
const isRefusal = (error: unknown): error is Error =>
    (error as { code?: unknown } | undefined)?.code === NOT_AUTHENTICATED
