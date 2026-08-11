import { useState } from 'react';

export function usePushNotifications(_userId: string | null) {
  const [expoPushToken] = useState<string | null>(null);
  return { expoPushToken };
}

// Push isn't available in Expo Go at all (SDK 53 removed it) — these mirror
// the dev-build module's exports so a caller (e.g. an "Enable Notifications"
// button) doesn't need to know which variant is active, and always gets a
// real, actionable reason instead of a silent no-op.
export async function registerForPushNotifications(_userId: string): Promise<string | null> {
  return null;
}

export function getLastPushRegistrationError(): 'expo-go' {
  return 'expo-go';
}

export async function checkPushPermissionStatus(): Promise<'unavailable'> {
  return 'unavailable';
}
