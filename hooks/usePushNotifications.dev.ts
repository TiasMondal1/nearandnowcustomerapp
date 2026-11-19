import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { C } from '../constants/colors';
import { apiFetch } from '../lib/apiClient';
import { getAppExtra } from '../lib/appExtra';
import { isNavReady, subscribeNavReady } from '../lib/bootGate';
import { getDevFlag } from '../lib/devFlags';
import { whenHomeSettled } from '../lib/firstRunPrompts';
import { logSilentFailure } from '../lib/logSilentFailure';
import { onNativePromptsSettled, runNativePrompt } from '../lib/pendingNativePrompts';

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

// One tapped notification opens its screen once. A launch tap can reach BOTH readers — the response listener
// and the cold-start `getLastNotificationResponseAsync()` snapshot (which is simply "the last response of this
// process") — and the cold-start read used to be guarded by a per-mount ref, so a second mount in the same
// process (the Activity recreated under a live JS runtime) read it again: the tracking screen was pushed twice.
// Both guards are module state now — one process, one cold-start read, one open per response.
let coldStartChecked = false;
let lastOpened: { key: string; at: number } | null = null;
/** The listener treats a repeat of the response it (or the cold-start read) just opened as the same delivery (ms). */
const DUPLICATE_RESPONSE_WINDOW_MS = 5000;

/** Request identifier + action: one key per tap. `null` (no identifier) is never deduped. */
function responseKey(response: Notifications.NotificationResponse): string | null {
  const identifier = response.notification.request.identifier;
  return identifier ? `${identifier}|${response.actionIdentifier}` : null;
}

/**
 * Opens the screen a tapped notification points at, at most once per response. `source: 'cold-start'` is the
 * snapshot read: whatever the listener already opened is skipped, however long ago. `'listener'` skips only an
 * immediate repeat, so a notification that stays in the tray can still be tapped again later. The push waits for
 * the boot redirect (lib/bootGate nav-ready: before it the push lands under index's replace and is lost — C23)
 * and for any native permission dialog to be gone and settled (lib/pendingNativePrompts — never a navigation in
 * the frame the Activity resumes). Returns the cancel, or `null` when nothing was scheduled (no data, or a
 * repeat of a response already handled) — the caller must then leave an open that is still pending alone.
 */
function openFromResponse(
  response: Notifications.NotificationResponse,
  source: 'cold-start' | 'listener',
): (() => void) | null {
  const data = response.notification.request.content.data as Record<string, unknown> | undefined;
  if (!data) return null;
  const key = responseKey(response);
  const now = Date.now();
  if (key && lastOpened?.key === key) {
    if (source === 'cold-start' || now - lastOpened.at < DUPLICATE_RESPONSE_WINDOW_MS) return null;
  }
  lastOpened = key ? { key, at: now } : null;

  let cancelled = false;
  let unsubscribe: (() => void) | null = null;
  let cancelSettled: (() => void) | null = null;
  const open = () => {
    unsubscribe?.();
    unsubscribe = null;
    if (cancelled) return;
    cancelSettled = onNativePromptsSettled(() => {
      if (!cancelled) navigateFromPushData(data);
    });
  };
  if (isNavReady()) open();
  else unsubscribe = subscribeNavReady(open);

  return () => {
    cancelled = true;
    unsubscribe?.();
    cancelSettled?.();
  };
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

  // Cold-start deep link: if the app was launched by tapping a notification,
  // getLastNotificationResponseAsync() has the data immediately — but
  // router.push() before app/index.tsx has issued its first replace lands
  // under (or races) that redirect and the deep link is lost (C23). Wait for
  // the boot gate's nav-ready flip (lib/bootGate — set on the frame after
  // index's replace) instead of useRootNavigationState, so this leaf never
  // re-renders on navigation state (P29); `openFromResponse` then pushes once
  // nothing native is in the way. The module flag makes the read happen at
  // most once per PROCESS, and only once it actually ran (a cleanup before
  // nav-ready simply re-arms on the next effect run).
  useEffect(() => {
    if (!userId || coldStartChecked) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let cancelOpen: (() => void) | null = null;

    const run = () => {
      if (cancelled || coldStartChecked) return;
      coldStartChecked = true;
      void Notifications.getLastNotificationResponseAsync()
        .then((response) => {
          if (cancelled || !response) return;
          cancelOpen = openFromResponse(response, 'cold-start');
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
      cancelOpen?.();
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    // `userId` flips from null to real the instant OTP verification succeeds
    // — just before app/otp.tsx replaces to /welcome or /onboarding, and
    // welcome then replaces to Home on its own. A permission request here
    // (a real native dialog/Activity on Android 13+'s POST_NOTIFICATIONS,
    // and on iOS) pauses the Activity under those queued navigations, which
    // then all land in the frames after the user answers — the "blank page
    // until cleared from recents" on a first login. The old deferral
    // (InteractionManager.runAfterInteractions) is a plain setImmediate in
    // this React Native version, so it deferred nothing. Now: when the
    // permission is already granted no dialog is possible and registration
    // runs at once; otherwise it waits until Home is the focused route and
    // has settled (lib/firstRunPrompts), and the dialog itself is serialised
    // with the location prompt (runNativePrompt in registerForPushNotifications).
    // Dev_Push_inhibit_Registration skips the whole step (no prompt, no
    // token upload) — the listeners below still attach.
    let cancelled = false;
    let homeWait: { cancel: () => void } | null = null;
    let cancelOpen: (() => void) | null = null;
    if (!getDevFlag('Dev_Push_inhibit_Registration')) {
      const register = () => {
        if (cancelled) return;
        void registerForPushNotifications(userId).then((token) => {
          if (!cancelled && token) setExpoPushToken(token);
        });
      };
      const registerOnHome = () => {
        if (cancelled) return;
        const wait = whenHomeSettled();
        homeWait = wait;
        void wait.promise.then(register);
      };
      checkPushPermissionStatus()
        .then((status) => (status === 'granted' ? register() : registerOnHome()))
        .catch((err) => {
          logSilentFailure('Read push permission', err);
          registerOnHome();
        });
    }

    notificationListener.current = Notifications.addNotificationReceivedListener(
      (_notification: Notifications.Notification) => {
        // Foreground: alert/banner/sound handled by setNotificationHandler above.
      },
    );

    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response: Notifications.NotificationResponse) => {
        // Replace the pending open only when a new one was scheduled: a repeat of the same response is deduped
        // (null), and cancelling first would drop the original open too — nothing would navigate.
        const next = openFromResponse(response, 'listener');
        if (next) {
          cancelOpen?.();
          cancelOpen = next;
        }
      },
    );

    return () => {
      cancelled = true;
      homeWait?.cancel();
      cancelOpen?.();
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
      // a real native dialog can appear. runNativePrompt starts it only
      // when nothing is navigating and no other prompt is up, and sets the
      // pending flag in the same tick, so otp / welcome / index hold their
      // redirects instead of navigating mid-dialog.
      const { status } = await runNativePrompt(() => Notifications.requestPermissionsAsync());
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
