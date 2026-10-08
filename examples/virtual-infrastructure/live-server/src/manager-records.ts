// ManagerRecords: mirrors the manager records into their store.
import type { ManagerRecord } from '@virtual-infrastructure/protocol/managers/managers.record'
import { DataManager } from 'live-system/core'
import type { DemoContext } from './context.ts'

/**
 * There is one manager record per manager that has one, with the manager's
 * key, each of its own type. They share one service and one store, so one
 * manager keeps that store a projection of the data service: this one. It
 * writes no record. Each manager creates and writes its own, through its own
 * source for the service, and watches the store for it.
 */
export class ManagerRecords extends DataManager<ManagerRecord, DemoContext> {}
