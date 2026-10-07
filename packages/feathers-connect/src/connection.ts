// FeathersConnection: the one connection to a Feathers data service, shared by every record source.
import { feathers, type Application } from '@feathersjs/feathers'
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
}

type ConnectionListener = () => void

const DEFAULT_CONNECT_TIMEOUT = 5000

/**
 * A socket connection to a Feathers data service. Services and record sources
 * can be taken from it, and listeners attached to them, before `connect()`:
 * nothing reaches the data service until the connection is made.
 */
export class FeathersConnection {
    #url: string
    #connectTimeout: number
    #socket: Socket
    #client: Application
    #connectedListeners = new Set<ConnectionListener>()
    #disconnectedListeners = new Set<ConnectionListener>()
    #reconnectedListeners = new Set<ConnectionListener>()
    #hasConnected = false

    constructor(options: FeathersConnectionOptions) {
        this.#url = options.url
        this.#connectTimeout = options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT

        this.#socket = io(this.#url, { transports: ['websocket'], autoConnect: false })
        this.#socket.on('connect', () => {
            const isReconnect = this.#hasConnected

            this.#hasConnected = true
            this.#emit(this.#connectedListeners)

            if (isReconnect) this.#emit(this.#reconnectedListeners)
        })
        this.#socket.on('disconnect', () => this.#emit(this.#disconnectedListeners))

        this.#client = feathers()
        this.#client.configure(socketio(this.#socket))
    }

    get url(): string {
        return this.#url
    }

    get isConnected(): boolean {
        return this.#socket.connected
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

    /** The Feathers service at a path, for what a record source does not offer. */
    service(path: string): FeathersServiceLike {
        return this.#client.service(path) as unknown as FeathersServiceLike
    }

    /** A record source over the service at a path. */
    recordSource<T extends HasId>(path: string, options?: FeathersRecordSourceOptions): FeathersRecordSource<T> {
        return new FeathersRecordSource<T>(this.service(path), {
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

    #on(listeners: Set<ConnectionListener>, listener: ConnectionListener): Unsubscribe {
        // A wrapper of its own, so the same function subscribed twice is two subscriptions
        const entry: ConnectionListener = () => listener()

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
