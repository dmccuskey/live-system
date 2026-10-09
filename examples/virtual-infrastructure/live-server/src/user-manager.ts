// UserManager: owns the users' existence. Each user's behavior is its VirtualUser's.
import type { AddUserResult } from '@virtual-infrastructure/protocol/users/users.commands'
import { USER_NAMES } from '@virtual-infrastructure/protocol/users/users.constants'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { USER_ROUTES } from '@virtual-infrastructure/protocol/users/users.routes'
import { CommandError, LiveObjectManager } from 'live-system/core'
import type { LiveObjectOptions, RouteParams, Routes } from 'live-system/core'
import type { DemoContext } from './context.ts'
import { createProfile } from './profile.ts'
import { VirtualUser } from './virtual-user.ts'

export class UserManager extends LiveObjectManager<UserRecord, VirtualUser, DemoContext> {
    override routes(): Routes {
        return {
            [USER_ROUTES.add]: this.addUser,
            [USER_ROUTES.remove]: this.removeUser,
        }
    }

    /** With no user nothing happens: a first one is created, so the system works without any input. */
    override async start(): Promise<void> {
        await super.start()

        if (this.objects.size === 0) await this.addUser()
    }

    /** Creates a user with the next free name and a random profile. */
    async addUser(): Promise<AddUserResult> {
        const { id } = await this.source.create({
            name: this.#nextName(),
            ...createProfile(this.context.random),
            frustration: 0,
            served: 1,
        })

        return { id }
    }

    async removeUser(params: RouteParams): Promise<void> {
        const id = params.id

        if (!id || !this.records.get(id)) {
            throw new CommandError('not_found', `There is no user '${id}'`)
        }

        await this.source.remove(id)
    }

    /** Tells the rest of the system, which may hold something of the user's. */
    protected override recordRemoved(record: UserRecord): void {
        super.recordRemoved(record)
        this.context.events.emit('userRemoved', { userId: record.id })
    }

    protected override createObject(record: UserRecord, options: LiveObjectOptions): VirtualUser {
        return new VirtualUser(record.id, this.records, this.source, this.context, options)
    }

    // The first name on the list that no user has, then 'User N'
    #nextName(): string {
        const taken = new Set(Object.values(this.records.records).map(record => record.name))
        const free = USER_NAMES.find(name => !taken.has(name))

        if (free) return free

        for (let number = USER_NAMES.length + 1; ; number++) {
            if (!taken.has(`User ${number}`)) return `User ${number}`
        }
    }
}
