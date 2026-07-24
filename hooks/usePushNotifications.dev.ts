import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { apiFetch } from '../lib/apiClient';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function resolveEasProjectId(): string | undefined {
  const fromEnv = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  if (fromEnv) return fromEnv;
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  const id = extra?.eas?.projectId?.trim();
  return id || undefined;
}

function navigateFromPushData(data: Record<string, unknown> | undefined) {
  if (!data) return;
  const raw =
    data.orderId ??
    data.order_id ??
    data.customer_order_id ??
    data.customerOrderId;
  const orderId = typeof raw === 'string' && raw.length > 0 ? raw : undefined;
  if (orderId) {
    router.push(`/order/track/${orderId}` as any);
  }
}

export function usePushNotifications(userId: string | null) {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);
  const navigationState = useRootNavigationState();
  const handledColdStartRef = useRef(false);

  // Cold-start deep link: if the app was launched by tapping a notification,
  // getLastNotificationResponseAsync() has the data immediately — but
  // router.push() before the root Stack has actually mounted its routes
  // silently no-ops, dropping the deep link. Wait for the navigator to be
  // ready (navigationState.key only exists once it is), and guard with a
  // ref so this can only ever fire once per app session even if the effect
  // re-runs for an unrelated reason.
  useEffect(() => {
    if (!userId || !navigationState?.key || handledColdStartRef.current) return;
    handledColdStartRef.current = true;
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const data = response?.notification.request.content
        .data as Record<string, unknown> | undefined;
      navigateFromPushData(data);
    });
  }, [userId, navigationState?.key]);

  useEffect(() => {
    if (!userId) return;

    registerForPushNotifications(userId).then((token) => {
      if (token) setExpoPushToken(token);
    });

    notificationListener.current = Notifications.addNotificationReceivedListener(
      (_notification: Notifications.Notification) => {
        // Foreground: alert/banner/sound handled by setNotificationHandler above.
      },
    );

    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response: Notifications.NotificationResponse) => {
        const data = response.notification.request.content.data as
          | Record<string, unknown>
          | undefined;
        navigateFromPushData(data);
      },
    );

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [userId]);

  return { expoPushToken };
}

async function registerForPushNotifications(userId: string): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      // Channel id bumped to _v2: Android locks a channel's sound at creation
      // time, so the previous 'orders' channel (already created on installed
      // devices without a custom sound) can never pick up order_chime.wav —
      // only a new channel id does.
      await Notifications.setNotificationChannelAsync('orders_v2', {
        name: 'Order Updates',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#0EA5E9',
        sound: 'order_chime.wav',
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return null;

    const projectId = resolveEasProjectId();
    const tokenData = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();

    const token = tokenData.data;

    await apiFetch('/api/push-token', {
      method: 'POST',
      body: JSON.stringify({ userId, token, platform: Platform.OS }),
    }).catch(() => {
      // Non-critical — app still works without push notifications
    });

    return token;
  } catch {
    return null;
  }
}
