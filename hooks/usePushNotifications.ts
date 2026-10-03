import Constants, { ExecutionEnvironment } from 'expo-constants';

// Keep this a runtime `require()` switch, not static imports — `usePushNotifications.dev.ts`
// calls `Notifications.setNotificationHandler(...)` at module top-level, which must never
// execute in Expo Go (SDK 53 removed remote push there). Static imports would evaluate both
// branches unconditionally. Keyed on executionEnvironment (K18) — `appOwnership` is deprecated.
type PushHookType = typeof import('./usePushNotifications.dev').usePushNotifications;

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

function loadImpl(): PushHookType {
  if (isExpoGo) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime switch keeps Notifications.setNotificationHandler out of Expo Go
    return require('./usePushNotifications.expo-go').usePushNotifications;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime switch keeps Notifications.setNotificationHandler out of Expo Go
  return require('./usePushNotifications.dev').usePushNotifications;
}

export const usePushNotifications: PushHookType = loadImpl();
