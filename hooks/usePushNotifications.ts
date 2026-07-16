import Constants from 'expo-constants';

// Keep this a runtime `require()` switch, not static imports — `usePushNotifications.dev.ts`
// calls `Notifications.setNotificationHandler(...)` at module top-level, which must never
// execute in Expo Go. Static imports would evaluate both branches unconditionally.
type PushHookType = typeof import('./usePushNotifications.dev').usePushNotifications;

const isExpoGo = Constants.appOwnership === 'expo';

export const usePushNotifications: PushHookType = isExpoGo
  ? require('./usePushNotifications.expo-go').usePushNotifications
  : require('./usePushNotifications.dev').usePushNotifications;
