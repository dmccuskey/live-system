// The command data types and command creators of the users domain.
import { fillRoute, type Command } from 'live-system/core'
import { USER_ROUTES } from './users.routes.ts'

/** What `users/add` answers with. */
export interface AddUserResult {
    id: string
}

/** Adds a user. The live server gives it its name and its profile. */
export function createAddUserCommand(): Command<undefined> {
    return { route: USER_ROUTES.add, data: undefined }
}

export function createRemoveUserCommand(id: string): Command<undefined> {
    return { route: fillRoute(USER_ROUTES.remove, { id }), data: undefined }
}
