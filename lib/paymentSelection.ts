/**
 * Lightweight module-level store for the currently selected payment method.
 *
 * The checkout screen and the payment-options screen are independent expo-router
 * routes, so we can't share React state directly. We could plumb this through
 * a context provider, but the value is truly singleton-scoped (there is only
 * one checkout at a time) and we want the options page to be able to flip the
 * selection and `router.back()` without any extra params/focus plumbing.
 *
 * Keep this small on purpose — just enough for the checkout's "Pay using" row
 * to display a friendly label and know which rails to run when the user taps
 * "Place order".
 *
 * Persistence (2026-10-03, speed-and-ease #20): the selection is remembered
 * across launches under `nn:payment:selection:v1` so a COD/wallet customer is
 * not reset to "Other UPI Apps" every time. `loadPaymentSelection()` runs at
 * app/_layout.tsx module scope; `resetPaymentSelection()` (logout) removes
 * the key. `Dev_Payment_inhibit_PersistSelection` turns both the read and the
 * writes off.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { getDevFlag } from './devFlags';
import { logSilentFailure } from './logSilentFailure';
import { PAYMENT_LOGOS, type PaymentLogoKey } from './paymentLogos';

/** Internal rail that the order will actually run on. */
export type PaymentMode = 'upi' | 'cod' | 'wallet';

/** Razorpay's `prefill.method` — lets us preselect the tab inside the sheet. */
export type RazorpayMethod = 'upi' | 'card' | 'netbanking' | 'wallet' | 'emi';

export type PaymentSelection = {
  mode: PaymentMode;
  /** Headline text, e.g. "UPI", "Card", "Cash on delivery". */
  label: string;
  /** Optional small line below. */
  subLabel?: string;
  /** Material Community icon name for the pay-row chip. */
  icon?: string;
  /**
   * Bundled brand mark key (see `paymentLogos.ts`). When set, the checkout
   * pay-dock and payment-options rows prefer this over the generic icon.
   */
  logoKey?: PaymentLogoKey;
  /**
   * If set and `mode === 'upi'`, this is passed to Razorpay's `prefill.method`
   * so the matching tab (UPI / Card / Netbanking / Wallet) is pre-selected
   * when the sheet opens. Not used for COD.
   */
  method?: RazorpayMethod;
  /**
   * If this selection is a Razorpay-remembered saved token (card / UPI VPA),
   * this is the Razorpay token id. Lets the backend attach it to the payment
   * create call when we later add Customer / Token APIs.
   */
  tokenId?: string;
};

/** AsyncStorage key (CONTRACTS §9). Reset on logout; the `v1` suffix is the payload version. */
export const PAYMENT_SELECTION_KEY = 'nn:payment:selection:v1';

const MODES: readonly PaymentMode[] = ['upi', 'cod', 'wallet'];
const METHODS: readonly RazorpayMethod[] = ['upi', 'card', 'netbanking', 'wallet', 'emi'];

const DEFAULT: PaymentSelection = {
  mode: 'upi',
  label: 'Other UPI Apps',
  subLabel: 'Any UPI ID or UPI app',
  icon: 'cellphone-wireless',
  logoKey: 'upi',
  method: 'upi',
};

// Canonical rows for the two non-Razorpay rails, shared by the payment-options
// sheet and the checkout pay-dock so the copy/icon never drifts between them.
// `lib/paymentLogos.ts` has no `cod`/`wallet` marks, so these carry an icon only.
/** Cash on delivery — `mode: 'cod'`, icon `cash`, no logo. */
export const COD_SELECTION: PaymentSelection = {
  mode: 'cod',
  label: 'Cash on delivery',
  subLabel: 'Pay when it arrives',
  icon: 'cash',
};
/** Near & Now wallet — `mode: 'wallet'`, icon `wallet-outline`, no logo. */
export const WALLET_SELECTION: PaymentSelection = {
  mode: 'wallet',
  label: 'Near & Now wallet',
  icon: 'wallet-outline',
};

let current: PaymentSelection = DEFAULT;
const listeners = new Set<(v: PaymentSelection) => void>();
let loadPromise: Promise<void> | null = null;
let loaded = false;
// A selection made before the disk read resolves (possible only in the first
// ~50 ms after launch) must win over the stale persisted one.
let touchedBeforeLoad = false;

function apply(next: PaymentSelection): void {
  current = next;
  for (const cb of listeners) cb(current);
}

function persist(next: PaymentSelection): void {
  if (getDevFlag('Dev_Payment_inhibit_PersistSelection')) return;
  AsyncStorage.setItem(PAYMENT_SELECTION_KEY, JSON.stringify(next)).catch((err) =>
    logSilentFailure('Persist payment selection', err),
  );
}

function isLogoKey(value: unknown): value is PaymentLogoKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PAYMENT_LOGOS, value);
}

/** Shape-checks a persisted payload; unknown logo keys / methods are dropped rather than trusted. */
function sanitize(raw: unknown): PaymentSelection | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.mode !== 'string' || !(MODES as readonly string[]).includes(r.mode)) return null;
  if (typeof r.label !== 'string' || !r.label) return null;
  const out: PaymentSelection = { mode: r.mode as PaymentMode, label: r.label };
  if (typeof r.subLabel === 'string') out.subLabel = r.subLabel;
  if (typeof r.icon === 'string') out.icon = r.icon;
  if (isLogoKey(r.logoKey)) out.logoKey = r.logoKey;
  if (typeof r.method === 'string' && (METHODS as readonly string[]).includes(r.method)) {
    out.method = r.method as RazorpayMethod;
  }
  if (typeof r.tokenId === 'string') out.tokenId = r.tokenId;
  return out;
}

/** Sync read of the current selection (DEFAULT = "Other UPI Apps" until set or hydrated). */
export function getPaymentSelection(): PaymentSelection {
  return current;
}

/** Sets + notifies subscribers synchronously, then persists best-effort (skipped under `Dev_Payment_inhibit_PersistSelection`). */
export function setPaymentSelection(next: PaymentSelection): void {
  if (!loaded) touchedBeforeLoad = true;
  apply(next);
  persist(next);
}

/** Subscribe to changes. The callback receives the new selection; returns the unsubscribe. */
export function subscribePaymentSelection(
  cb: (v: PaymentSelection) => void,
): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Back to DEFAULT + removes the persisted key (logout cascade; also a dev action). */
export function resetPaymentSelection(): void {
  apply(DEFAULT);
  AsyncStorage.removeItem(PAYMENT_SELECTION_KEY).catch((err) =>
    logSilentFailure('Clear persisted payment selection', err),
  );
}

/**
 * Idempotent hydrate from `nn:payment:selection:v1`. Call once at
 * app/_layout.tsx module scope. Applies the stored selection WITHOUT
 * re-persisting it; skips the read entirely under
 * `Dev_Payment_inhibit_PersistSelection`; never rejects.
 */
export function loadPaymentSelection(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    if (getDevFlag('Dev_Payment_inhibit_PersistSelection')) {
      loaded = true;
      return;
    }
    try {
      const raw = await AsyncStorage.getItem(PAYMENT_SELECTION_KEY);
      const parsed = raw ? sanitize(JSON.parse(raw)) : null;
      if (parsed && !touchedBeforeLoad) apply(parsed);
    } catch (err) {
      logSilentFailure('Hydrate payment selection', err);
    }
    loaded = true;
  })();
  return loadPromise;
}

/** `useSyncExternalStore` over the module store — subscribe in LEAF components (the pay-dock row), not the whole checkout. */
export function usePaymentSelection(): PaymentSelection {
  return useSyncExternalStore(subscribePaymentSelection, getPaymentSelection, getPaymentSelection);
}
