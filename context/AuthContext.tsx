import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, InteractionManager, type AppStateStatus } from 'react-native';

import { apiFetch, setAuthToken, setSessionExpiredHandler } from '../lib/apiClient';
import {
  changeCustomerEmail,
  getCurrentUserFromSession,
  resendEmailVerificationCode,
  sendOTP,
  updateCustomerProfile,
  verifyCustomerEmailCode,
  verifyOTP,
  type AppUser,
  type Customer,
} from '../lib/authService';
import { markBoot } from '../lib/bootGate';
import { clearLiveAddressCache } from '../lib/liveAddress';
import { logSilentFailure } from '../lib/logSilentFailure';
import { clearNotificationsMemory } from '../lib/notificationService';
import { clearOrderHistoryFlag } from '../lib/orderHistoryFlag';
import { clearOrdersMemory } from '../lib/orderService';
import { resetPaymentSelection } from '../lib/paymentSelection';
import { clearUserScoped } from '../lib/queryCache';
import { clearSavedPaymentMethodsCache } from '../lib/razorpayService';
import { resetStoreServiceCaches } from '../lib/storeService';
import { clearWishlistMemory } from '../lib/wishlistStore';

// Renews the sliding 25-day session window as a side effect of requireCustomer
// (see backend customerAuth.middleware.ts). Fired on cold start and on every
// foreground resume so simply opening/using the app counts as activity —
// not just ordering-related actions, which are the only other calls that
// happen to hit a requireCustomer route. Fire-and-forget; a missed ping just
// means the next one (or the next real API call) renews it instead.
function pingSession() {
  apiFetch('/api/customers/session/ping').catch((err) => logSilentFailure('Session ping', err));
}

/**
 * How long the cold-start profile fetch may hold `isLoading` when `userData`
 * is missing or corrupt (MAP C24 — previously up to the 30 s request timeout,
 * i.e. 30 s of native splash). Past this the session is restored optimistically
 * from userId + token with a placeholder user and revalidated after first paint.
 */
const SESSION_FETCH_TIMEOUT_MS = 6000;
const UNCONFIRMED = Symbol('unconfirmed');

interface AuthContextType {
  user: AppUser | null;
  customer: Customer | null;
  userId: string | null;
  userToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  sendOTPCode: (phone: string) => Promise<void>;
  verifyOTPCode: (phone: string, otp: string, name?: string, email?: string) => Promise<{ isNewUser: boolean }>;
  logoutUser: () => Promise<void>;
  updateUserProfile: (data: Parameters<typeof updateCustomerProfile>[0]) => Promise<void>;
  changeEmail: (email: string) => Promise<void>;
  verifyEmailCode: (code: string) => Promise<void>;
  resendEmailCode: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function safeParse<T>(raw: string): T | null {
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** What the UI shows while the real profile is still being fetched; never persisted to `userData`. */
function placeholderUser(id: string): AppUser {
  return {
    id,
    name: 'Customer',
    email: null,
    phone: null,
    role: 'customer',
    is_activated: true,
    created_at: '',
    updated_at: '',
  };
}

/** Resolves with the value, or with UNCONFIRMED after `ms` (or if the promise rejects) — never rejects. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof UNCONFIRMED> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(UNCONFIRMED), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(UNCONFIRMED);
      },
    );
  });
}

function runAfterInteractions(fn: () => void): void {
  InteractionManager.runAfterInteractions(() => {
    fn();
  });
}

async function persistUserData(user: AppUser, customer: Customer | null | undefined): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem('userData', JSON.stringify(user)),
    AsyncStorage.setItem('customerData', customer ? JSON.stringify(customer) : ''),
  ]);
}

function definedOnly<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userToken, setUserToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Bumped by every session boundary (OTP verified, session cleared). Async
  // work captures it at the start and drops its result if it changed — a 401
  // arriving mid-restore (which clears the session through apiClient's
  // handler) must not be followed by an optimistic "authenticated" write.
  const sessionGenRef = useRef(0);

  // Boot timeline (kepler): `auth-ready` is the moment the splash may drop.
  useEffect(() => {
    if (!isLoading) markBoot('auth-ready');
  }, [isLoading]);

  const clearStoredSession = useCallback(async () => {
    sessionGenRef.current += 1;
    // In-memory first and synchronously: the bearer memo, then every
    // user-scoped memory mirror (rev. 2) so a second user on the same device
    // never sees the first user's orders, unread count, wishlist, nearby
    // filter, live address or cached queries. Device-scoped stores (the dev
    // flags, feedback prefs and recent searches) are deliberately NOT touched.
    setAuthToken(null);
    clearUserScoped();
    resetStoreServiceCaches();
    clearWishlistMemory();
    clearOrdersMemory();
    clearNotificationsMemory();
    clearLiveAddressCache();
    // Wipe user-scoped caches so the next user doesn't inherit any of the
    // previous user's state (saved Razorpay tokens, first-order flag,
    // selected payment method — the last of these was previously missed:
    // resetPaymentSelection existed but had zero call sites, so a picked
    // saved card/UPI selection survived logout and appeared pre-selected
    // for the next customer on a shared device).
    clearSavedPaymentMethodsCache();
    resetPaymentSelection();

    // Flip the UI state before the storage round trips so logout feels
    // instant; the true→false transition drives the Cart/Location clears.
    setUser(null);
    setCustomer(null);
    setUserId(null);
    setUserToken(null);
    setIsAuthenticated(false);

    // Each removal is isolated: SecureStore.deleteItemAsync can throw on a
    // device whose Keystore was invalidated, and that must not leave the
    // AsyncStorage keys (and the next cold start) believing a session exists.
    await Promise.all([
      AsyncStorage.multiRemove(['userId', 'userData', 'customerData']).catch((err) =>
        logSilentFailure('Clear stored session', err),
      ),
      SecureStore.deleteItemAsync('userToken').catch((err) =>
        logSilentFailure('Clear stored token', err),
      ),
      clearOrderHistoryFlag(),
    ]);
  }, []);

  const revalidateSession = useCallback(async () => {
    const gen = sessionGenRef.current;
    try {
      const fresh = await getCurrentUserFromSession();
      if (!fresh || sessionGenRef.current !== gen) return;
      setUser(fresh.user);
      setCustomer(fresh.customer || null);
      await persistUserData(fresh.user, fresh.customer);
      // Never auto-logout from background revalidation — only explicit logoutUser() clears the session.
      // Returning null here means the DB query couldn't find/reach the user (RLS, network, etc.),
      // which is NOT a reason to sign out.
    } catch {
      // Network / permission error: keep the optimistic session as-is.
    }
  }, []);

  /**
   * Optimistic hydrate: if cached user exists, render as authenticated immediately
   * and revalidate against the backend in the background. Network failure alone
   * does NOT log the user out; only an explicit 401 (via apiClient's
   * session-expired handler) does.
   *
   * Storage is read in parallel (one AsyncStorage multiGet + one SecureStore
   * read, MAP P19) and `isLoading` is never behind the network for more than
   * SESSION_FETCH_TIMEOUT_MS (C24). Nothing hits the network before first paint:
   * revalidate + ping are deferred past interactions.
   */
  const restoreSession = useCallback(async () => {
    const gen = sessionGenRef.current;
    try {
      const [storageResult, secureResult] = await Promise.allSettled([
        AsyncStorage.multiGet(['userId', 'userData', 'customerData', 'userToken']),
        // SecureStore.getItemAsync can itself throw (Android Keystore invalidated
        // by an OS security patch, biometric re-enrollment, some OEM bugs) —
        // allSettled lets that failure fall through to the legacy-token check
        // below instead of rejecting the whole read and skipping straight to a
        // silent logout in the outer catch.
        SecureStore.getItemAsync('userToken'),
      ]);

      const stored: Record<string, string | null> = {};
      if (storageResult.status === 'fulfilled') {
        for (const [key, value] of storageResult.value) stored[key] = value;
      }
      const storedUserId = stored.userId ?? null;
      const rawUser = stored.userData ?? null;
      const rawCustomer = stored.customerData ?? null;
      const legacyToken = stored.userToken ?? null;

      let storedToken: string | null = secureResult.status === 'fulfilled' ? secureResult.value : null;

      // One-time migration: installs from before the SecureStore switch have the
      // token sitting in plain AsyncStorage under the same key. Without this,
      // every existing logged-in user gets silently signed out on update. Only
      // runs when SecureStore missed (or threw).
      if (!storedToken && legacyToken) {
        storedToken = legacyToken;
        try {
          await SecureStore.setItemAsync('userToken', legacyToken);
          await AsyncStorage.removeItem('userToken');
        } catch {
          // Migration write failed too — still use the legacy token this
          // session; a later successful write will migrate it.
        }
      }

      if (!storedUserId || !storedToken) {
        // Known guest: prime the memo with null so no request pays a Keystore read.
        setAuthToken(null);
        setIsAuthenticated(false);
        return;
      }

      // Known as early as possible so any request racing restore skips SecureStore.
      setAuthToken(storedToken);

      const cachedUser: AppUser | null = rawUser ? safeParse<AppUser>(rawUser) : null;
      const cachedCustomer: Customer | null = rawCustomer ? safeParse<Customer>(rawCustomer) : null;

      if (cachedUser) {
        setUser(cachedUser);
        setCustomer(cachedCustomer);
        setUserId(storedUserId);
        setUserToken(storedToken);
        setIsAuthenticated(true);
        runAfterInteractions(() => {
          void revalidateSession();
          pingSession();
        });
        return;
      }

      // userData missing/corrupt: race the profile fetch against the budget.
      // (lib/authService.getCurrentUserFromSession has no timeout option yet —
      // W2-auth owns it — so it is raced locally.)
      const fresh = await withTimeout(getCurrentUserFromSession(), SESSION_FETCH_TIMEOUT_MS);
      if (sessionGenRef.current !== gen) return; // a 401 during the fetch already cleared the session

      if (fresh !== UNCONFIRMED && fresh !== null) {
        setUser(fresh.user);
        setCustomer(fresh.customer || null);
        setUserId(storedUserId);
        setUserToken(storedToken);
        setIsAuthenticated(true);
        runAfterInteractions(pingSession);
        persistUserData(fresh.user, fresh.customer).catch((err) =>
          logSilentFailure('Persist restored session', err),
        );
        return;
      }

      // Timed out, offline, or otherwise unconfirmed: mark authenticated
      // optimistically from userId + token with a placeholder user and let
      // revalidateSession() fill it in after first paint. A genuinely dead
      // session surfaces as a 401 on the next authenticated call, which
      // apiClient routes to clearStoredSession.
      setUser(placeholderUser(storedUserId));
      setCustomer(null);
      setUserId(storedUserId);
      setUserToken(storedToken);
      setIsAuthenticated(true);
      runAfterInteractions(() => {
        void revalidateSession();
        pingSession();
      });
    } catch (err) {
      logSilentFailure('Restore session', err);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, [revalidateSession]);

  useEffect(() => {
    void restoreSession();
    // Lets apiClient.ts clear the session (and flip isAuthenticated) the moment
    // any API call comes back 401 — not just calls AuthContext itself makes —
    // so a genuinely expired session (25 days of inactivity) is handled from
    // wherever the user happens to be in the app, not just on next cold start.
    setSessionExpiredHandler(() => {
      void clearStoredSession();
    });
    return () => setSessionExpiredHandler(null);
  }, [restoreSession, clearStoredSession]);

  // Cold start alone isn't enough — someone can keep the app backgrounded for
  // weeks and just resume it from the app switcher without a fresh launch.
  // Ping on every foreground resume too, so any real use of the app renews
  // the session, matching "count from the last time they were active."
  const isAuthenticatedRef = useRef(isAuthenticated);
  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active' && isAuthenticatedRef.current) {
        pingSession();
      }
    });
    return () => subscription.remove();
  }, []);

  const sendOTPCode = useCallback(async (phone: string) => {
    await sendOTP(phone);
  }, []);

  const verifyOTPCode = useCallback(async (phone: string, otp: string, name = 'Customer', email?: string) => {
    // This call is the only step that can legitimately mean "verification
    // failed" — it's the one that talks to the backend/Twilio. Everything
    // below is local post-login bookkeeping; a hiccup there (e.g. a
    // transient SecureStore/AsyncStorage error) must never be reported back
    // to the caller as a failed login, since the backend has already
    // authenticated the user and issued a session token by this point.
    // Mirrors the same fix applied to the rider app's otp.tsx/riderVerification.ts.
    const response = await verifyOTP(phone, otp, name, email);
    const isNewUser = response.isNewUser;

    sessionGenRef.current += 1;
    setAuthToken(response.token);
    setUser(response.user);
    setCustomer(response.customer || null);
    setUserId(response.user.id);
    setUserToken(response.token);
    setIsAuthenticated(true);

    try {
      await Promise.all([
        AsyncStorage.setItem('userId', response.user.id),
        SecureStore.setItemAsync('userToken', response.token),
        persistUserData(response.user, response.customer),
      ]);
    } catch (err) {
      logSilentFailure('Persist session after OTP verification', err);
    }

    return { isNewUser };
  }, []);

  const logoutUser = useCallback(async () => {
    // Best-effort, before the local session is wiped (needs the still-valid
    // token to authenticate) — clears this device's push token server-side
    // so a shared/reused device doesn't keep receiving the previous
    // customer's order notifications after they've logged out.
    // 5 s cap (not the 30 s default): on a captive portal / dead Wi-Fi the Log out row must not hang for half a
    // minute before the local session clears (W3 R6-08). The await stays — resolveToken() runs after an await
    // inside apiFetch and clearStoredSession nulls the memo.
    await apiFetch('/api/push-token', {
      method: 'POST',
      body: JSON.stringify({ token: null }),
      timeoutMs: 5000,
    }).catch((err) => logSilentFailure('Clear push token on logout', err));
    await clearStoredSession();
  }, [clearStoredSession]);

  // Optimistic (speed-and-ease #33): the local user/customer are patched
  // before the PATCH resolves and rolled back if it throws; the authoritative
  // profile is re-fetched afterwards and persisted.
  const updateUserProfile = useCallback(
    async (data: Parameters<typeof updateCustomerProfile>[0]) => {
      if (!user) throw new Error('No user logged in');

      const previousUser = user;
      const previousCustomer = customer;
      const patch = definedOnly(data);
      const optimisticUser: AppUser = {
        ...user,
        ...(typeof patch.name === 'string' && patch.name ? { name: patch.name } : {}),
      };
      const optimisticCustomer: Customer | null = customer ? { ...customer, ...patch } : customer;
      setUser(optimisticUser);
      setCustomer(optimisticCustomer);

      try {
        await updateCustomerProfile(data);
      } catch (err) {
        setUser(previousUser);
        setCustomer(previousCustomer);
        throw err;
      }

      const refreshed = await getCurrentUserFromSession();
      if (refreshed) {
        setUser(refreshed.user);
        setCustomer(refreshed.customer || null);
        await persistUserData(refreshed.user, refreshed.customer);
      } else {
        await persistUserData(optimisticUser, optimisticCustomer);
      }
    },
    [user, customer],
  );

  const changeEmail = useCallback(async (email: string) => {
    await changeCustomerEmail(email);
  }, []);

  const verifyEmailCode = useCallback(
    async (code: string) => {
      const { email } = await verifyCustomerEmailCode(code);
      if (user) {
        const updatedUser = { ...user, email, email_verified_at: new Date().toISOString() };
        setUser(updatedUser);
        await AsyncStorage.setItem('userData', JSON.stringify(updatedUser));
      }
    },
    [user],
  );

  const resendEmailCode = useCallback(async () => {
    await resendEmailVerificationCode();
  }, []);

  // Memoised so AuthProvider's own re-renders don't re-render every
  // useAuth() consumer (MAP P25) — handlers above are useCallback'd for the
  // same reason.
  const value = useMemo<AuthContextType>(
    () => ({
      user,
      customer,
      userId,
      userToken,
      isLoading,
      isAuthenticated,
      sendOTPCode,
      verifyOTPCode,
      logoutUser,
      updateUserProfile,
      changeEmail,
      verifyEmailCode,
      resendEmailCode,
    }),
    [
      user,
      customer,
      userId,
      userToken,
      isLoading,
      isAuthenticated,
      sendOTPCode,
      verifyOTPCode,
      logoutUser,
      updateUserProfile,
      changeEmail,
      verifyEmailCode,
      resendEmailCode,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
