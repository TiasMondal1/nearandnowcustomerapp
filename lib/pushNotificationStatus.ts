import Constants from 'expo-constants';

// Same conditional-require switch as hooks/usePushNotifications.ts — static
// imports would evaluate the dev-build module's top-level
// Notifications.setNotificationHandler(...) call even inside Expo Go.
type Mod = typeof import('../hooks/usePushNotifications.dev');

const isExpoGo = Constants.appOwnership === 'expo';

const impl: Mod = isExpoGo
  ? (require('../hooks/usePushNotifications.expo-go') as Mod)
  : (require('../hooks/usePushNotifications.dev') as Mod);

export const registerForPushNotifications = impl.registerForPushNotifications;
export const getLastPushRegistrationError = impl.getLastPushRegistrationError;
export const checkPushPermissionStatus = impl.checkPushPermissionStatus;
