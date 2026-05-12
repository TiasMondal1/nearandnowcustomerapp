import { useState } from 'react';

export function usePushNotifications(_userId: string | null) {
  const [expoPushToken] = useState<string | null>(null);
  return { expoPushToken };
}
