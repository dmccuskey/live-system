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

/** The events of the live server's event bus, by name. */
export interface DemoEvents {
    commandRequested: CommandRequestedEvent
    commandQueued: CommandQueuedEvent
    commandStarted: CommandStartedEvent
    commandRefused: CommandRefusedEvent
    commandFinished: CommandFinishedEvent
    userRemoved: UserRemovedEvent
}
