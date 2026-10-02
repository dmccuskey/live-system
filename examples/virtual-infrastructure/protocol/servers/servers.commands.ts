// The command data types and command creators of the servers domain.
import { fillRoute, type Command } from 'live-system/core'
import { SERVER_ROUTES } from './servers.routes.ts'

/** What `servers/add` answers with. */
export interface AddServerResult {
    id: string
}

export function createAddServerCommand(): Command<undefined> {
    return { route: SERVER_ROUTES.add, data: undefined }
}

export function createRemoveServerCommand(id: string): Command<undefined> {
    return { route: fillRoute(SERVER_ROUTES.remove, { id }), data: undefined }
}
