import { apiFetch } from './apiClient';

/**
 * Backend response from POST /api/payment/create.
 *
 * Matches the contract in `near-and-now/backend/src/services/payment.service.ts`
 * (`PaymentService.createPaymentOrder`). The backend always derives the trusted
 * amount from the *internal* `customer_orders.total_amount` row, so we MUST
 * create the internal order first and pass `orderId` through.
 */
export interface CreatePaymentOrderResponse {
  /** Razorpay-issued order id, e.g. `order_PNkWvY...`. Pass to RazorpayCheckout `order_id`. */
  razorpay_order_id: string;
  /** Amount in paise — comes back from Razorpay. Use this, not your local total. */
  amount: number;
  currency: string;
  status: string;
  /**
   * Public Razorpay key id (`rzp_test_...` or `rzp_live_...`). Sourced from the
   * backend so we can swap test ↔ live without redeploying the app, and so
   * the client never has to embed the key in a public env var.
   */
  key_id: string;
  razorpay_mode?: 'test' | 'live';
}

export interface VerifyPaymentRequest {
  /** `razorpay_payment_id` from RazorpayCheckout success handler */
  paymentId: string;
  /** `razorpay_order_id` from RazorpayCheckout success handler */
  razorpayOrderId: string;
  /** `razorpay_signature` from RazorpayCheckout success handler (HMAC, must verify server-side) */
  signature: string;
  /** Our internal `customer_orders.id` — backend uses it to flip payment_status → 'paid'. */
  internalOrderId: string;
}

/**
 * Step 1 of the online-payment flow.
 *
 * Creates a Razorpay order *for an internal order that already exists*. The
 * backend looks up the order, uses its `total_amount` as the trusted amount
 * (the client-supplied `amount` is only a sanity check), and returns
 * everything RazorpayCheckout needs to open.
 */
export async function createPaymentOrder(
  internalOrderId: string,
  amountRupees: number,
): Promise<CreatePaymentOrderResponse> {
  return apiFetch<CreatePaymentOrderResponse>('/api/payment/create', {
    method: 'POST',
    body: JSON.stringify({
      orderId: internalOrderId,
      amount: amountRupees,
      currency: 'INR',
    }),
  });
}

/**
 * Step 3 of the online-payment flow (Razorpay UI runs in between).
 *
 * Sends the Razorpay success payload to the backend, which:
 *   1. Verifies the HMAC-SHA256 signature server-side.
 *   2. Explicitly captures the authorized payment.
 *   3. Cross-checks status, order_id, and amount against Razorpay's API.
 *   4. Persists the gateway response and flips `customer_orders.payment_status` to `paid`.
 *
 * This call is **mandatory** — without it, the order stays in `pending` even
 * after a successful Razorpay UI flow and the customer will get a "Payment
 * pending" reminder.
 */
export async function verifyPayment(payload: VerifyPaymentRequest): Promise<void> {
  await apiFetch<{ success?: boolean; message?: string }>('/api/payment/verify', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ─── Saved payment methods (Razorpay Tokens API) ─────────────────────────────

export type SavedPaymentMethod = {
  /** Razorpay token id — opaque, passed back to the payment create call. */
  tokenId: string;
  /** Rail this token runs on. */
  method: 'card' | 'upi';
  /** Short human label, e.g. "HDFC Bank Card", "user@okaxis". */
  label: string;
  /** Smaller line below, e.g. "•••• 3085", "UPI ID". */
  subLabel?: string;
  /** Card network or UPI handle, for icon hinting. */
  network?: string;
  /** Optional last4 for cards. */
  last4?: string;
};

/**
 * Fetches the user's saved Razorpay payment methods.
 *
 * NOTE: This depends on a backend endpoint (`GET /api/payment/methods`) that
 * wraps Razorpay's Customer + Tokens APIs. That endpoint is optional — the
 * app works fine without it, we just show an empty "Preferred Payment"
 * section until the backend surfaces saved tokens.
 *
 * To enable this end-to-end:
 *   1. Create a Razorpay `customer_id` on first payment (server-side).
 *   2. Store it on the user row (e.g. `users.razorpay_customer_id`).
 *   3. Add `remember_customer: true` at checkout (already done below).
 *   4. Implement `GET /api/payment/methods` on the backend that calls
 *      `razorpay.customers.fetchTokens(customerId)` and returns the shape
 *      above.
 *
 * We swallow errors here — this is a best-effort enhancement, never a blocker.
 *
 * Results are cached at module scope so subsequent visits to the payment
 * options screen paint instantly instead of flashing a spinner while the
 * same data is refetched on every mount. Pass `{ force: true }` to bypass
 * the cache (e.g. after a successful payment where a new token may now
 * exist).
 */
// Cache is keyed by the user id so switching accounts (or signing out/in)
// never leaks another user's tokens. `null` key = anonymous / not set.
let __savedMethodsCache: SavedPaymentMethod[] | null = null;
let __savedMethodsCacheKey: string | null = null;
let __savedMethodsInFlight: Promise<SavedPaymentMethod[]> | null = null;

export function getCachedSavedPaymentMethods(
  userId?: string | null,
): SavedPaymentMethod[] | null {
  // Only honour the cache if it belongs to the caller. Mismatch → force
  // a fresh fetch. This matters when a user logs out/in without a full app
  // restart; otherwise the new user would see the old user's cached list
  // for one frame.
  if (userId && __savedMethodsCacheKey && userId !== __savedMethodsCacheKey) {
    return null;
  }
  return __savedMethodsCache;
}

/**
 * Hard ceiling on how long the saved-methods fetch can take before we give
 * up and resolve empty. The backend endpoint is optional (it may 404 or not
 * even exist on older API deploys) and React Native's fetch has no default
 * timeout, so without this a slow/hanging response would leave the
 * "Preferred Payment" card stuck on its skeleton forever.
 */
const SAVED_METHODS_TIMEOUT_MS = 4000;

/**
 * Feature flag. Until the backend implements the full Razorpay customer +
 * tokens pipeline, there is nothing to fetch — no Razorpay Customer is
 * attached to our orders, so Razorpay never tokenizes the card in the first
 * place. Hitting /api/payment/methods in that state just adds a 4s timeout
 * to every visit to the payment-options screen.
 *
 * When the backend ships:
 *   1. `POST /orders` gets a Razorpay `customer_id` attached
 *   2. `GET  /api/payment/methods` exists and returns SavedPaymentMethod[]
 *
 * ...set `EXPO_PUBLIC_SAVED_METHODS_ENABLED=true` in `.env` (no rebuild —
 * Expo Router picks this up on reload) and saved methods will start
 * populating automatically.
 */
const SAVED_METHODS_ENABLED =
  (process.env.EXPO_PUBLIC_SAVED_METHODS_ENABLED || '').toLowerCase() === 'true';

export function isSavedPaymentMethodsEnabled(): boolean {
  return SAVED_METHODS_ENABLED;
}

export async function getSavedPaymentMethods(
  userId: string | null | undefined,
  options?: { force?: boolean },
): Promise<SavedPaymentMethod[]> {
  // Feature-flag short-circuit. When the backend pipeline isn't wired, resolve
  // empty synchronously so the UI never flashes a skeleton it can't resolve.
  if (!SAVED_METHODS_ENABLED) {
    __savedMethodsCache = [];
    __savedMethodsCacheKey = null;
    return __savedMethodsCache;
  }

  // Without a user id there is no one to look tokens up for. Treat this as
  // "not logged in" — empty and instant, no network.
  if (!userId) {
    __savedMethodsCache = [];
    __savedMethodsCacheKey = null;
    return __savedMethodsCache;
  }

  const sameUserCache =
    __savedMethodsCache != null && __savedMethodsCacheKey === userId;

  if (!options?.force) {
    if (sameUserCache) return __savedMethodsCache!;
    if (__savedMethodsInFlight) return __savedMethodsInFlight;
  }

  __savedMethodsInFlight = (async () => {
    try {
      const methods = await Promise.race<SavedPaymentMethod[]>([
        apiFetch<{ methods?: SavedPaymentMethod[] }>(
          `/api/payment/methods?user_id=${encodeURIComponent(userId)}`,
          { method: 'GET' },
        ).then((res) => res?.methods ?? []),
        new Promise<SavedPaymentMethod[]>((resolve) =>
          setTimeout(() => resolve([]), SAVED_METHODS_TIMEOUT_MS),
        ),
      ]);
      __savedMethodsCache = methods;
      __savedMethodsCacheKey = userId;
      return methods;
    } catch {
      // Cache the empty result too — we don't want to keep re-hitting a
      // flaky endpoint on every revisit. Still key by user so the next
      // user's lookup doesn't inherit this empty result.
      __savedMethodsCache = [];
      __savedMethodsCacheKey = userId;
      return [];
    } finally {
      __savedMethodsInFlight = null;
    }
  })();
  return __savedMethodsInFlight;
}

export function clearSavedPaymentMethodsCache(): void {
  __savedMethodsCache = null;
  __savedMethodsCacheKey = null;
  __savedMethodsInFlight = null;
}
