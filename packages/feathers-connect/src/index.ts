// The Feathers connection and the record sources over its services.
// No dependency on LiveSystem.
export { FeathersConnection, type FeathersConnectionOptions } from './connection.ts'
export {
    FeathersRecordSource,
    type FeathersRecordSourceOptions,
    type FeathersServiceLike,
    type FindPageOptions,
    type HasId,
    type NewRecord,
    type RecordConversion,
    type RecordListener,
    type RecordPage,
    type Unsubscribe,
} from './record-source.ts'
