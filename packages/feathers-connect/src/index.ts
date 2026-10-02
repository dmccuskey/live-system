// The Feathers connection and the record sources over its services.
// No dependency on LiveSystem.
export { FeathersConnection, type FeathersConnectionOptions } from './connection.ts'
export {
    FeathersRecordSource,
    type FeathersRecordSourceOptions,
    type FeathersServiceLike,
    type HasId,
    type NewRecord,
    type RecordListener,
    type Unsubscribe
} from './record-source.ts'
