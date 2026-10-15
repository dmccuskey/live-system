// The record store as a Pinia store. On a subpath of its own, so that an app
// that brings its own RecordStore never imports Pinia.
export { defineRecordStore } from './record-store.ts'
