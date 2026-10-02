// SettingsManager: owns the settings records, which the managers they are for watch in the store.
import type { SettingsUpdate } from '@virtual-infrastructure/protocol/settings/settings.commands'
import {
    DEFAULT_SETTINGS,
    MAX_MAX_UTILIZATION,
    MIN_MAX_UTILIZATION,
} from '@virtual-infrastructure/protocol/settings/settings.constants'
import type { SettingsRecord } from '@virtual-infrastructure/protocol/settings/settings.record'
import { SETTINGS_ROUTES } from '@virtual-infrastructure/protocol/settings/settings.routes'
import { CommandError, DataManager } from 'live-system/core'
import type { RouteParams, Routes } from 'live-system/core'
import type { DemoContext } from './context.ts'

/**
 * There is one settings record per manager that has settings, with the
 * manager's key. Its ID is the data service's to give. Which records there
 * must be is in the protocol's `DEFAULT_SETTINGS`: `init()` creates the one
 * of each key that has none. The UI changes one through the route.
 *
 * This manager only writes to the data service. The change comes back as an
 * event of the service and lands in the settings store, as with every kind of
 * record: the store is a projection of the data service. The manager the
 * settings are for watches the store for the record with its key.
 */
export class SettingsManager extends DataManager<SettingsRecord, DemoContext> {
    // Who waits for a created record to arrive in the store, by the record's ID
    #awaited = new Map<string, () => void>()

    override routes(): Routes {
        return {
            [SETTINGS_ROUTES.update]: this.updateSettings,
        }
    }

    /**
     * Loads the records, then creates the one of each key that has none, with
     * its defaults. A created record reaches the store with the data service's
     * event, which may come after the answer to the create: `init()` waits for
     * it, so every record is in the store when the managers start.
     */
    override async init(): Promise<void> {
        await super.init()

        for (const defaults of Object.values(DEFAULT_SETTINGS)) {
            if (this.#byKey(defaults.key)) continue

            const { id } = await this.source.create({ ...defaults })

            if (!this.records.get(id)) await new Promise<void>(resolve => this.#awaited.set(id, resolve))
        }
    }

    /** Lets go of an `init()` that still waits. */
    override async stop(): Promise<void> {
        for (const resolve of this.#awaited.values()) resolve()
        this.#awaited.clear()

        await super.stop()
    }

    protected override recordAdded(record: SettingsRecord): void {
        this.#awaited.get(record.id)?.()
        this.#awaited.delete(record.id)
    }

    async updateSettings(params: RouteParams, data: SettingsUpdate): Promise<void> {
        const record = this.#byKey(params.key)

        if (!record) {
            throw new CommandError('not_found', `There are no settings '${params.key}'`)
        }

        const changes: SettingsUpdate = {}
        const { scalingMode, maxUtilization } = data ?? {}

        if (scalingMode !== undefined) {
            if (scalingMode !== 'automatic' && scalingMode !== 'manual') {
                throw new CommandError('bad_request', `The scaling mode is 'automatic' or 'manual', not '${scalingMode}'`)
            }

            changes.scalingMode = scalingMode
        }

        if (maxUtilization !== undefined) {
            if (
                typeof maxUtilization !== 'number' ||
                !(maxUtilization >= MIN_MAX_UTILIZATION && maxUtilization <= MAX_MAX_UTILIZATION)
            ) {
                throw new CommandError(
                    'bad_request',
                    `The maximum utilization is a number from ${MIN_MAX_UTILIZATION} to ${MAX_MAX_UTILIZATION}`,
                )
            }

            changes.maxUtilization = maxUtilization
        }

        if (Object.keys(changes).length === 0) {
            throw new CommandError('bad_request', 'There is nothing to change')
        }

        await this.source.patch(record.id, changes)
    }

    #byKey(key: string | undefined): SettingsRecord | undefined {
        return Object.values(this.records.records).find(record => record.key === key)
    }
}
