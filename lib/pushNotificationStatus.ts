import Constants, { ExecutionEnvironment } from 'expo-constants';

// Same conditional-require switch as hooks/usePushNotifications.ts — static
// imports would evaluate the dev-build module's top-level
// Notifications.setNotificationHandler(...) call even inside Expo Go.
type Mod = typeof import('../hooks/usePushNotifications.dev');

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

function loadImpl(): Mod {
  if (isExpoGo) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime switch keeps Notifications.setNotificationHandler out of Expo Go
    return require('../hooks/usePushNotifications.expo-go') as Mod;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime switch keeps Notifications.setNotificationHandler out of Expo Go
  return require('../hooks/usePushNotifications.dev') as Mod;
}

const impl: Mod = loadImpl();

export const registerForPushNotifications = impl.registerForPushNotifications;
export const getLastPushRegistrationError = impl.getLastPushRegistrationError;
export const checkPushPermissionStatus = impl.checkPushPermissionStatus;
/** Last Expo push token obtained in this process (null = none yet / Expo Go). Dev panel shows its tail. */
export const getLastPushToken = impl.getLastPushToken;
