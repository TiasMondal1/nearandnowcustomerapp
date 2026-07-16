import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
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
import { apiFetch, setSessionExpiredHandler } from '../lib/apiClient';
import { clearOrderHistoryFlag } from '../lib/orderHistoryFlag';
import { clearSavedPaymentMethodsCache } from '../lib/razorpayService';

// Renews the sliding 25-day session window as a side effect of requireCustomer
// (see backend customerAuth.middleware.ts). Fired on cold start and on every
// foreground resume so simply opening/using the app counts as activity —
// not just ordering-related actions, which are the only other calls that
// happen to hit a requireCustomer route. Fire-and-forget; a missed ping just
// means the next one (or the next real API call) renews it instead.
function pingSession() {
  apiFetch('/api/customers/session/ping').catch(() => {});
}

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
  updateUserProfile: (data: Parameters<typeof updateCustomerProfile>[1]) => Promise<void>;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userToken, setUserToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    restoreSession();
    // Lets apiClient.ts clear the session (and flip isAuthenticated) the moment
    // any API call comes back 401 — not just calls AuthContext itself makes —
    // so a genuinely expired session (25 days of inactivity) is handled from
    // wherever the user happens to be in the app, not just on next cold start.
    setSessionExpiredHandler(() => {
      clearStoredSession();
    });
    return () => setSessionExpiredHandler(null);
  }, []);

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

  /**
   * Optimistic hydrate: if cached user exists, render as authenticated immediately
   * and revalidate against the backend in the background. Network failure alone
   * does NOT log the user out; only an explicit "user not found" response does.
   */
  const restoreSession = async () => {
    try {
      const [storedUserId, secureToken, rawUser, rawCustomer] = await Promise.all([
        AsyncStorage.getItem('userId'),
        SecureStore.getItemAsync('userToken'),
        AsyncStorage.getItem('userData'),
        AsyncStorage.getItem('customerData'),
      ]);

      // One-time migration: installs from before the SecureStore switch have the
      // token sitting in plain AsyncStorage under the same key. Without this,
      // every existing logged-in user gets silently signed out on update.
      let storedToken = secureToken;
      if (!storedToken) {
        const legacyToken = await AsyncStorage.getItem('userToken');
        if (legacyToken) {
          storedToken = legacyToken;
          await SecureStore.setItemAsync('userToken', legacyToken);
          await AsyncStorage.removeItem('userToken');
        }
      }

      if (!storedUserId || !storedToken) {
        setIsAuthenticated(false);
        setIsLoading(false);
        return;
      }

      const cachedUser: AppUser | null = rawUser ? safeParse<AppUser>(rawUser) : null;
      const cachedCustomer: Customer | null = rawCustomer ? safeParse<Customer>(rawCustomer) : null;

      if (cachedUser) {
        setUser(cachedUser);
        setCustomer(cachedCustomer);
        setUserId(storedUserId);
        setUserToken(storedToken);
        setIsAuthenticated(true);
        setIsLoading(false);
        revalidateSession(storedUserId);
        pingSession();
        return;
      }

      const fresh = await getCurrentUserFromSession(storedUserId);
      if (fresh) {
        setUser(fresh.user);
        setCustomer(fresh.customer || null);
        setUserId(storedUserId);
        setUserToken(storedToken);
        setIsAuthenticated(true);
        pingSession();
        await Promise.all([
          AsyncStorage.setItem('userData', JSON.stringify(fresh.user)),
          AsyncStorage.setItem(
            'customerData',
            fresh.customer ? JSON.stringify(fresh.customer) : '',
          ),
        ]);
      } else {
        await clearStoredSession();
      }
    } catch {
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  const revalidateSession = async (id: string) => {
    try {
      const fresh = await getCurrentUserFromSession(id);
      if (fresh) {
        setUser(fresh.user);
        setCustomer(fresh.customer || null);
        await Promise.all([
          AsyncStorage.setItem('userData', JSON.stringify(fresh.user)),
          AsyncStorage.setItem(
            'customerData',
            fresh.customer ? JSON.stringify(fresh.customer) : '',
          ),
        ]);
      }
      // Never auto-logout from background revalidation — only explicit logoutUser() clears the session.
      // Returning null here means the DB query couldn't find/reach the user (RLS, network, etc.),
      // which is NOT a reason to sign out.
    } catch {
      // Network / permission error: keep the optimistic session as-is.
    }
  };

  const clearStoredSession = async () => {
    await Promise.all([
      AsyncStorage.removeItem('userId'),
      SecureStore.deleteItemAsync('userToken'),
      AsyncStorage.removeItem('userData'),
      AsyncStorage.removeItem('customerData'),
    ]);
    // Wipe user-scoped caches so the next user doesn't inherit any of the
    // previous user's state (saved Razorpay tokens, first-order flag).
    clearSavedPaymentMethodsCache();
    await clearOrderHistoryFlag();
    setUser(null);
    setCustomer(null);
    setUserId(null);
    setUserToken(null);
    setIsAuthenticated(false);
  };

  const sendOTPCode = async (phone: string) => {
    await sendOTP(phone);
  };

  const verifyOTPCode = async (phone: string, otp: string, name = 'Customer', email?: string) => {
    const response = await verifyOTP(phone, otp, name, email);
    const isNewUser = response.isNewUser;

    setUser(response.user);
    setCustomer(response.customer || null);
    setUserId(response.user.id);
    setUserToken(response.token);
    setIsAuthenticated(true);

    await Promise.all([
      AsyncStorage.setItem('userId', response.user.id),
      SecureStore.setItemAsync('userToken', response.token),
      AsyncStorage.setItem('userData', JSON.stringify(response.user)),
      AsyncStorage.setItem(
        'customerData',
        response.customer ? JSON.stringify(response.customer) : '',
      ),
    ]);

    return { isNewUser };
  };

  const logoutUser = async () => {
    await clearStoredSession();
  };

  const updateUserProfile = async (data: Parameters<typeof updateCustomerProfile>[1]) => {
    if (!user) throw new Error('No user logged in');

    await updateCustomerProfile(user.id, data);

    const refreshed = await getCurrentUserFromSession(user.id);
    if (refreshed) {
      setUser(refreshed.user);
      setCustomer(refreshed.customer || null);
      await Promise.all([
        AsyncStorage.setItem('userData', JSON.stringify(refreshed.user)),
        AsyncStorage.setItem(
          'customerData',
          refreshed.customer ? JSON.stringify(refreshed.customer) : '',
        ),
      ]);
    } else {
      const updatedUser = {
        ...user,
        ...(data.name && { name: data.name }),
      };
      setUser(updatedUser);
      await AsyncStorage.setItem('userData', JSON.stringify(updatedUser));
    }
  };

  const changeEmail = async (email: string) => {
    await changeCustomerEmail(email);
  };

  const verifyEmailCode = async (code: string) => {
    const { email } = await verifyCustomerEmailCode(code);
    if (user) {
      const updatedUser = { ...user, email, email_verified_at: new Date().toISOString() };
      setUser(updatedUser);
      await AsyncStorage.setItem('userData', JSON.stringify(updatedUser));
    }
  };

  const resendEmailCode = async () => {
    await resendEmailVerificationCode();
  };

  return (
    <AuthContext.Provider
      value={{
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
