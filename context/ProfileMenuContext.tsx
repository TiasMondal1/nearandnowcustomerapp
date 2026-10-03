// codename: atlas
// ProfileMenuContext — "account everywhere" (CONTRACTS §3.5): one ProfileMenu sheet mounted once, openable from any
// tab header, with the unread-notification count DERIVED from lib/notificationService so the avatar dot is right on
// a cold start before the inbox was ever opened. The provider refreshes the count once per authenticated session
// and on reconnect; AuthContext's `clearNotificationsMemory()` drives it to 0 on logout, and the provider also closes
// the sheet on the authenticated → unauthenticated transition (wasAuthenticatedRef pattern, MAP §7.14).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import ProfileMenu from '../components/ProfileMenu';
import { useRefetchOnReconnect } from '../hooks/useRefetchOnReconnect';
import { logSilentFailure } from '../lib/logSilentFailure';
import { getNotifications, useUnreadCount } from '../lib/notificationService';
import { loadWishlist } from '../lib/wishlistStore';
import { useAuth } from './AuthContext';

export type ProfileMenuValue = {
  /** Sheet visibility. */
  isOpen: boolean;
  /** Opens the sheet (silent — the BottomSheet plays the swoosh). */
  open: () => void;
  /** Closes the sheet. */
  close: () => void;
  /** DERIVED from `lib/notificationService` `useUnreadCount()` — never screen-set, so it is right on cold start. */
  unreadCount: number;
  /** `getNotifications(userId).catch(logSilentFailure)`; no-op while signed out. Home calls it on focus. */
  refreshUnread: () => void;
};

/**
 * `components/ProfileMenu.tsx` takes `{ visible, onClose, unreadCount? }` (CONTRACTS §6.4; W1.5 adds `unreadCount`).
 * Until then the component declares FEWER props, which TypeScript accepts when assigning to a component type that
 * declares the optional extra — so the provider can pass `unreadCount` today with no cast, and the prop simply
 * starts being read when W1.5 lands.
 */
type ProfileMenuSheetProps = { visible: boolean; onClose: () => void; unreadCount?: number };
const ProfileMenuSheet: React.ComponentType<ProfileMenuSheetProps> = ProfileMenu;

const noop = (): void => {};

/** Inert default so a screen rendered before the provider mounts (W1.5 wires app/_layout.tsx) degrades to "no sheet". */
const INERT_VALUE: ProfileMenuValue = {
  isOpen: false,
  open: noop,
  close: noop,
  unreadCount: 0,
  refreshUnread: noop,
};

const ProfileMenuContext = createContext<ProfileMenuValue>(INERT_VALUE);

/**
 * Renders `{children}` then `<ProfileMenu visible={isOpen} onClose={close} unreadCount={unreadCount} />` ONCE.
 * Mount inside `AuthProvider` (it reads `useAuth().userId` / `.isAuthenticated`). Nothing else may import
 * `components/ProfileMenu.tsx`.
 */
export function ProfileMenuProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { userId, isAuthenticated } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const unreadCount = useUnreadCount();

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const refreshUnread = useCallback(() => {
    if (!userId) return;
    getNotifications(userId).catch((err) => logSilentFailure('Refresh unread', err));
  }, [userId]);

  // Wishlist membership (`useIsWishlisted` / ProductCard hearts) reads memory only and the hook deliberately never
  // auto-fetches (guests would 401 on every cold start) — one warm load per authenticated session + on reconnect
  // keeps the hearts right before the user ever opens /wishlist (W1-services-data note, applied W1.5).
  const warmWishlist = useCallback(() => {
    if (!userId) return;
    loadWishlist().catch((err) => logSilentFailure('Load wishlist', err));
  }, [userId]);

  // Once per authenticated session: when `userId` becomes non-null (cold start restore or a fresh login). The ref is
  // keyed by user id and reset on sign-out so the next sign-in refreshes again.
  const refreshedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!userId) {
      refreshedForRef.current = null;
      return;
    }
    if (refreshedForRef.current === userId) return;
    refreshedForRef.current = userId;
    refreshUnread();
    warmWishlist();
  }, [userId, refreshUnread, warmWishlist]);

  useRefetchOnReconnect(refreshUnread, !!userId);
  useRefetchOnReconnect(warmWishlist, !!userId);

  // Logout = authenticated true → false transition (not the initial restore): close the sheet. The count itself is
  // zeroed by AuthContext.clearStoredSession() → clearNotificationsMemory().
  const wasAuthenticatedRef = useRef(isAuthenticated);
  useEffect(() => {
    if (isAuthenticated) {
      wasAuthenticatedRef.current = true;
    } else if (wasAuthenticatedRef.current) {
      wasAuthenticatedRef.current = false;
      setIsOpen(false);
    }
  }, [isAuthenticated]);

  const value = useMemo<ProfileMenuValue>(
    () => ({ isOpen, open, close, unreadCount, refreshUnread }),
    [isOpen, open, close, unreadCount, refreshUnread],
  );

  return (
    <ProfileMenuContext.Provider value={value}>
      {children}
      <ProfileMenuSheet visible={isOpen} onClose={close} unreadCount={unreadCount} />
    </ProfileMenuContext.Provider>
  );
}

/** `{ isOpen, open, close, unreadCount, refreshUnread }`; an inert value outside the provider (never throws). */
export function useProfileMenu(): ProfileMenuValue {
  return useContext(ProfileMenuContext);
}
