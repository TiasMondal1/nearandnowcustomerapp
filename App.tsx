// App.tsx
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import phone from "./app/phone";
import OtpScreen from "./src/screens/otp";
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: 'https://ae2a67c0e263527f9b1c4f0a9bbb8ef6@o4511242276569088.ingest.de.sentry.io/4511242284892240',

  // Adds more context data to events (IP address, cookies, user, etc.)
  // For more information, visit: https://docs.sentry.io/platforms/react-native/data-management/data-collected/
  sendDefaultPii: true,

  // Enable Logs
  enableLogs: true,

  // Configure Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1,
  integrations: [Sentry.mobileReplayIntegration(), Sentry.feedbackIntegration()],

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: __DEV__,
});

export type RootStackParamList = {
  Phone: undefined;
  Otp: { phone: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default Sentry.wrap(function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Phone"
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Phone" component={phone} />
        <Stack.Screen name="Otp" component={OtpScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
});
