// The demo's event definitions: how a user's command travels within the live server.
// Routes are for what the UI sends in. What the users generate goes over the event bus.
import type { CommandType } from './servers/servers.constants.ts'

/** A user asks for a command to be run. The user gives it its ID, to know its outcome by. */
export interface CommandRequestedEvent {
    commandId: string
    userId: string
    type: CommandType
}

/** A server has taken the command and runs it. */
export interface CommandStartedEvent extends CommandRequestedEvent {
    serverId: string
}

/** The command waits in the queue: for room on a server, or for one of its user's running commands to finish. */
export type CommandQueuedEvent = CommandRequestedEvent

/** The command will not be run: this is its end. */
export interface CommandRefusedEvent extends CommandRequestedEvent {
    /**
     * `queue_full`: its user already has a command waiting.
     * `dropped`: it was waiting when its user was removed or the system stopped.
     */
    reason: 'queue_full' | 'dropped'
}

/** The command has left its server: it ran to its end, or the server went away under it. */
export interface CommandFinishedEvent extends CommandStartedEvent {
    outcome: 'completed' | 'aborted'
}

/** A user has been removed. */
export interface UserRemovedEvent {
    userId: string
}

/** The number of commands that wait in the `ServerManager`'s queue has changed. */
export interface QueueChangedEvent {
    length: number
}

/** The utilization of the servers as a whole has changed. */
export interface UtilizationChangedEvent {
    /** The load of all servers over their capacity, a fraction from 0 to 1. With no server, 0. */
    utilization: number
}

/**
 * The events of the live server's event bus, by name. What a manager reports
 * of its own status is named after the manager: `servers.queueChanged`.
 */
export interface DemoEvents {
    commandRequested: CommandRequestedEvent
    commandQueued: CommandQueuedEvent
    commandStarted: CommandStartedEvent
    commandRefused: CommandRefusedEvent
    commandFinished: CommandFinishedEvent
    userRemoved: UserRemovedEvent
    'servers.queueChanged': QueueChangedEvent
    'servers.utilizationChanged': UtilizationChangedEvent
}
