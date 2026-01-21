// App.tsx
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import phone from "./app/phone";
import OtpScreen from "./src/screens/otp";

export type RootStackParamList = {
  Phone: undefined;
  Otp: { phone: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
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
}
