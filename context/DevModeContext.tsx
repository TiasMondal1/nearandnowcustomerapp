// codename: indigo
/**
 * Dev-mode gate + panel visibility (DECISIONS D2, CONTRACTS §3.4, design §4.1).
 *
 *   LOCKED ── shake / ProfileMenu long-press ──▶ version toast (id 'dev-version', neutral, 3 s, no haptic)
 *          ── 5 taps on it within 3 s ──▶ PIN sheet ── unlockDev() 'ok' ──▶ (sheet dismissed) ──▶ PANEL
 *   UNLOCKED ── pill tap / shake (unless Dev_Indigo_inhibit_ShakeOpen) / long-press ──▶ PANEL
 *   PANEL "Lock dev mode" ──▶ lockDev() (clears unlock + flags) + feedback.toggle(false) + panel closes
 *
 * The provider renders `{children}` then `<DevPanelHost/>`, which draws the stripe, the pill, the PIN sheet and the panel.
 * `requestDevUnlock()` is the module-level escape hatch for ProfileMenu's footer long-press (called from its BottomSheet
 * `onDismiss`, so the toast renders in the root ToastHost — CONTRACTS §3.4 rev. 2). The shake hook is enabled only off
 * web and while neither the panel nor the PIN sheet is open; it never fires while a native prompt is pending.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { DevPanelHost } from '../components/dev/DevPanelHost';
import { dismissToast, notify } from '../components/ui';
import { useShakeDetector } from '../hooks/useShakeDetector';
import { getAppVersion } from '../lib/appExtra';
import { getDevFlag, isDevUnlocked, lockDev, useDevUnlocked } from '../lib/devFlags';
import { feedback } from '../lib/feedback';

export type DevUnlockSource = 'shake' | 'long-press' | 'pill';

export type DevModeValue = {
  unlocked: boolean;
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  /** Starts the D2 gate: version toast (id 'dev-version') → 5 taps within 3 s → PIN sheet. When already unlocked, opens the panel directly. */
  requestUnlock: (source: DevUnlockSource) => void;
  lock: () => Promise<void>;
  // ── Optional extras (consumed by DevPanelHost / DevPanel only) ──
  /** The PIN sheet is showing. */
  pinOpen: boolean;
  /** User intent to close the PIN sheet (scrim, pan, back, close button). */
  closePin: () => void;
  /** The PIN matched: closes the sheet and arms "open the panel once the sheet has dismissed". */
  onPinUnlocked: () => void;
  /** The PIN sheet's native Modal is gone: opens the panel if armed (never in the same tick as the close — MAP §7.5). */
  onPinDismissed: () => void;
  /** ms epoch of the unlock in this process; null while locked or when the unlock was hydrated from disk ("before launch"). */
  unlockedAt: number | null;
};

/** Toast id of the version toast (same id → re-notify restarts it instead of stacking). */
const VERSION_TOAST_ID = 'dev-version';
/** Version toast lifetime (D2). */
const VERSION_TOAST_MS = 3000;
/** Taps needed on the toast and the window (from the first tap) they must land in (D2). */
const TAP_TARGET = 5;
const TAP_WINDOW_MS = 3000;
/** Extra time after the toast's duration before the tap counter resets (covers the exit animation). */
const TOAST_EXIT_GRACE_MS = 500;

const DevModeContext = createContext<DevModeValue | null>(null);

/** Set by the mounted provider; read by `requestDevUnlock()`. */
let mountedRequestUnlock: ((source: DevUnlockSource) => void) | null = null;

/**
 * Owns the shake hook, the version-toast tap counter, the PIN sheet and panel visibility; renders `<DevPanelHost/>`
 * after `children`. Mount it inside Cart/Location/ProfileMenu providers (CONTRACTS §6.1) — the panel's Session tab
 * reads `useAuth()` and `useLocation()`.
 */
export function DevModeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const unlocked = useDevUnlocked();
  const [panelOpen, setPanelOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [unlockedAt, setUnlockedAt] = useState<number | null>(null);

  const tapCountRef = useRef(0);
  const firstTapAtRef = useRef(0);
  const windowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openAfterPinRef = useRef(false);

  const clearTimer = (ref: React.RefObject<ReturnType<typeof setTimeout> | null>) => {
    if (ref.current) {
      clearTimeout(ref.current);
      ref.current = null;
    }
  };

  const resetTaps = useCallback(() => {
    tapCountRef.current = 0;
    firstTapAtRef.current = 0;
    clearTimer(windowTimerRef);
  }, []);

  useEffect(
    () => () => {
      clearTimer(windowTimerRef);
      clearTimer(toastTimerRef);
    },
    [],
  );

  const openPanel = useCallback(() => {
    setPinOpen(false);
    setPanelOpen(true);
  }, []);
  const closePanel = useCallback(() => setPanelOpen(false), []);
  const closePin = useCallback(() => setPinOpen(false), []);

  /** 5th tap within 3 s of the first → dismiss the toast and show the PIN sheet; a stale window restarts the count. */
  const onVersionTap = useCallback(() => {
    const now = Date.now();
    if (firstTapAtRef.current === 0 || now - firstTapAtRef.current > TAP_WINDOW_MS) {
      firstTapAtRef.current = now;
      tapCountRef.current = 0;
      clearTimer(windowTimerRef);
      windowTimerRef.current = setTimeout(resetTaps, TAP_WINDOW_MS);
    }
    tapCountRef.current += 1;
    if (tapCountRef.current < TAP_TARGET) return;
    resetTaps();
    clearTimer(toastTimerRef);
    dismissToast(VERSION_TOAST_ID);
    setPinOpen(true);
  }, [resetTaps]);

  const requestUnlock = useCallback(
    (source: DevUnlockSource) => {
      if (isDevUnlocked()) {
        openPanel();
        return;
      }
      if (source === 'pill') {
        // The pill is already a deliberate target (only visible in __DEV__ while locked) — skip the toast step.
        setPinOpen(true);
        return;
      }
      resetTaps();
      const { version, build } = getAppVersion();
      notify({
        id: VERSION_TOAST_ID,
        title: `Near & Now v${version} (${build})`,
        tone: 'neutral',
        duration: VERSION_TOAST_MS,
        haptic: false,
        onPress: onVersionTap,
      });
      // The counter also resets when the toast leaves (duration + exit grace).
      clearTimer(toastTimerRef);
      toastTimerRef.current = setTimeout(resetTaps, VERSION_TOAST_MS + TOAST_EXIT_GRACE_MS);
    },
    [onVersionTap, openPanel, resetTaps],
  );

  const onPinUnlocked = useCallback(() => {
    openAfterPinRef.current = true;
    setUnlockedAt(Date.now());
    setPinOpen(false);
  }, []);

  const onPinDismissed = useCallback(() => {
    if (!openAfterPinRef.current) return;
    openAfterPinRef.current = false;
    setPanelOpen(true);
  }, []);

  const lock = useCallback(async () => {
    await lockDev();
    setPanelOpen(false);
    setPinOpen(false);
    setUnlockedAt(null);
    feedback.toggle(false);
  }, []);

  // Shake: unlocked → panel (unless Dev_Indigo_inhibit_ShakeOpen); locked → the gate. Off while a sheet is open.
  const onShake = useCallback(() => {
    if (isDevUnlocked()) {
      if (getDevFlag('Dev_Indigo_inhibit_ShakeOpen')) return;
      openPanel();
      return;
    }
    requestUnlock('shake');
  }, [openPanel, requestUnlock]);
  useShakeDetector(onShake, { enabled: Platform.OS !== 'web' && !panelOpen && !pinOpen });

  // Module-level escape hatch for non-React callers (ProfileMenu long-press).
  useEffect(() => {
    mountedRequestUnlock = requestUnlock;
    return () => {
      if (mountedRequestUnlock === requestUnlock) mountedRequestUnlock = null;
    };
  }, [requestUnlock]);

  const value = useMemo<DevModeValue>(
    () => ({
      unlocked,
      panelOpen,
      openPanel,
      closePanel,
      requestUnlock,
      lock,
      pinOpen,
      closePin,
      onPinUnlocked,
      onPinDismissed,
      unlockedAt,
    }),
    [unlocked, panelOpen, openPanel, closePanel, requestUnlock, lock, pinOpen, closePin, onPinUnlocked, onPinDismissed, unlockedAt],
  );

  return (
    <DevModeContext.Provider value={value}>
      {children}
      <DevPanelHost />
    </DevModeContext.Provider>
  );
}

/** Throws outside the provider (CONTRACTS §3.4). */
export function useDevMode(): DevModeValue {
  const ctx = useContext(DevModeContext);
  if (!ctx) throw new Error('useDevMode must be used inside <DevModeProvider>');
  return ctx;
}

/**
 * Module-level escape hatch for non-React callers (ProfileMenu's 3 s footer long-press, called from its sheet's
 * `onDismiss`). No-op while no provider is mounted.
 */
export function requestDevUnlock(source: DevUnlockSource): void {
  mountedRequestUnlock?.(source);
}
