import Constants from 'expo-constants';

const isExpoGo = Constants.appOwnership === 'expo';

if (isExpoGo) {
  module.exports = require('./usePushNotifications.expo-go');
} else {
  module.exports = require('./usePushNotifications.dev');
}
