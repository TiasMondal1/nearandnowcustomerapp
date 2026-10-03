import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';

import { C } from '../constants/colors';
import { apiFetch } from '../lib/apiClient';
import { getAppExtra } from '../lib/appExtra';
import { isNavReady, subscribeNavReady } from '../lib/bootGate';
import { getDevFlag } from '../lib/devFlags';
import { logSilentFailure } from '../lib/logSilentFailure';
import { beginNativePrompt } from '../lib/pendingNativePrompts';

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
  // lib/appExtra is the one typed view of `expoConfig.extra` (CONTRACTS §2.24) — no cast here.
  const id = getAppExtra().eas?.projectId?.trim();
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
    // Typed template href (MAP §2.5 #21) — `/order/track/${SingleRoutePart}` accepts it without a cast.
    router.push(`/order/track/${orderId}`);
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

// Last token obtained in this process — the hook keeps it in state for its caller; this module-level
// mirror lets non-React readers (the dev panel's Session tab) show its tail.
let lastPushToken: string | null = null;

/** The last Expo push token obtained in this process, or null (never registered / failed / Expo Go). */
export function getLastPushToken(): string | null {
  return lastPushToken;
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
  const handledColdStartRef = useRef(false);

  // Cold-start deep link: if the app was launched by tapping a notification,
  // getLastNotificationResponseAsync() has the data immediately — but
  // router.push() before app/index.tsx has issued its first replace lands
  // under (or races) that redirect and the deep link is lost (C23). Wait for
  // the boot gate's nav-ready flip (lib/bootGate — set on the frame after
  // index's replace) instead of useRootNavigationState, so this leaf never
  // re-renders on navigation state (P29); then push after interactions so it
  // does not fight the Home transition. The ref makes this fire at most once
  // per app session, and only once it actually ran (a cleanup before nav-ready
  // simply re-arms on the next effect run).
  useEffect(() => {
    if (!userId || handledColdStartRef.current) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let interaction: { cancel: () => void } | null = null;

    const run = () => {
      if (cancelled || handledColdStartRef.current) return;
      handledColdStartRef.current = true;
      void Notifications.getLastNotificationResponseAsync()
        .then((response) => {
          if (cancelled) return;
          const data = response?.notification.request.content
            .data as Record<string, unknown> | undefined;
          if (!data) return;
          interaction = InteractionManager.runAfterInteractions(() => {
            if (!cancelled) navigateFromPushData(data);
          });
        })
        .catch((err) => logSilentFailure('Read cold-start push response', err));
    };

    if (isNavReady()) {
      run();
    } else {
      unsubscribe = subscribeNavReady(() => {
        unsubscribe?.();
        unsubscribe = null;
        run();
      });
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
      interaction?.cancel();
    };
  }, [userId]);

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
    // race entirely. Dev_Push_inhibit_Registration skips the whole step
    // (no prompt, no token upload) — the listeners below still attach.
    let cancelled = false;
    const handle = getDevFlag('Dev_Push_inhibit_Registration')
      ? null
      : InteractionManager.runAfterInteractions(() => {
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
      handle?.cancel?.();
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [userId]);

  return { expoPushToken };
}

export async function registerForPushNotifications(userId: string): Promise<string | null> {
  lastRegistrationError = null;
  // Dev seam: skip registration entirely (no channel, no permission prompt, no token upload).
  if (getDevFlag('Dev_Push_inhibit_Registration')) return null;
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
        lightColor: C.primary,
        sound: 'order_chime.wav',
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      // Only undetermined here on a clean install (or a fresh reinstall) —
      // a real native dialog can appear. Marked pending so welcome.tsx's
      // auto-advance timer waits it out instead of navigating mid-dialog.
      const releasePrompt = beginNativePrompt();
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      } finally {
        releasePrompt();
      }
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
    lastPushToken = token;

    await apiFetch('/api/push-token', {
      method: 'POST',
      body: JSON.stringify({ userId, token, platform: Platform.OS }),
    }).catch((err) => {
      // Non-critical — app still works without push notifications.
      logSilentFailure('Upload push token', err);
    });

    return token;
  } catch {
    lastRegistrationError = 'unknown';
    return null;
  }
}
