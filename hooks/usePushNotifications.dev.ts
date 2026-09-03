import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';

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

// Set right before every failure return in registerForPushNotifications so
// a caller (e.g. a "Enable Notifications" button) can show a specific,
// actionable message instead of a silent no-op on failure — same pattern
// already built for the store-owner app's NotificationSettings.tsx.
let lastRegistrationError: 'expo-go' | 'permission-denied' | 'token-failed' | 'unknown' | null = null;

export function getLastPushRegistrationError() {
  return lastRegistrationError;
}

/** Current permission state without prompting — for an "Enable" button to know whether to show itself. */
export async function checkPushPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined' | 'unavailable'> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
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

    // `userId` flips from null to real the instant OTP verification succeeds
    // — the same render pass in which app/otp.tsx calls router.replace() to
    // /welcome or /onboarding. Calling registerForPushNotifications()
    // synchronously here means its permission request (a real native
    // dialog/Activity on Android 13+'s POST_NOTIFICATIONS, and on iOS) can
    // fire while that Stack transition is still animating — a known
    // Android crash class ("...after onSaveInstanceState") when a native
    // dialog is requested mid-transition, which kills the JS thread before
    // React's ErrorBoundary ever gets a chance to catch anything, seen as a
    // black screen rather than the boundary's "Something went wrong" UI.
    // Deferring past the transition (same InteractionManager pattern
    // app/(tabs)/home.tsx already uses for its own post-login GPS call, for
    // the identical "don't compete with a transition" reason) avoids the
    // race entirely.
    let cancelled = false;
    const handle = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      registerForPushNotifications(userId).then((token) => {
        if (!cancelled && token) setExpoPushToken(token);
      });
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
      cancelled = true;
      handle.cancel?.();
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [userId]);

  return { expoPushToken };
}

export async function registerForPushNotifications(userId: string): Promise<string | null> {
  lastRegistrationError = null;
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

    if (finalStatus !== 'granted') {
      lastRegistrationError = 'permission-denied';
      return null;
    }

    const projectId = resolveEasProjectId();
    let tokenData;
    try {
      tokenData = projectId
        ? await Notifications.getExpoPushTokenAsync({ projectId })
        : await Notifications.getExpoPushTokenAsync();
    } catch {
      lastRegistrationError = 'token-failed';
      return null;
    }

    const token = tokenData.data;
    if (!token) {
      lastRegistrationError = 'token-failed';
      return null;
    }

    await apiFetch('/api/push-token', {
      method: 'POST',
      body: JSON.stringify({ userId, token, platform: Platform.OS }),
    }).catch(() => {
      // Non-critical — app still works without push notifications
    });

    return token;
  } catch {
    lastRegistrationError = 'unknown';
    return null;
  }
}
