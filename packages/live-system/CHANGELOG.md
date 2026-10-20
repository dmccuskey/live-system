# Changelog

Notable changes, newest first. The versions follow [Semantic Versioning](https://semver.org): before 1.0, a breaking change raises the minor version. Each version is released as a tarball under a tag `live-system-v<version>` (see [Install](README.md#install)).

## 0.1.0

The first release.

- `live-system/core`: the `LifecycleRunner`, `LiveSystem`, `BaseManager`, `LiveObject` and `LiveObjectManager`; the command types, `CommandError` and `fillRoute`; `RecordSource` and `MemoryRecordSource`; `RecordStore` and `createRecordStore`; `DataManager`, with the startup sync and the resync after a lost connection; `debouncePatch`; the `EventBus`; the `Clock`, with `systemClock`, `scaledClock` and `FakeClock`.
- `live-system/server`: the `Router` and the `CommandServer`.
- `live-system/web`: the `CommandClient`, `WebStartup` and `readable()`.
- `live-system/pinia`: `defineRecordStore`.
