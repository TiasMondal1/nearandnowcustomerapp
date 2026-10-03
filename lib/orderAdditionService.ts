import { apiFetch } from './apiClient';
import { invalidateOrders } from './orderService';

/**
 * Backend for the confirmation screen's 30-second "add more items" window —
 * merges items added during that window into the just-placed order (same
 * store trip, same delivery) instead of them becoming a separate purchase.
 * The original order's payment is untouched; added items get their own,
 * separate Razorpay charge for just the delta.
 *
 * Both calls are triggered ONLY by the confirmation screen's explicit
 * "Pay ₹X to add N items" button (codename nova, MAP C14 — nothing here is
 * ever auto-run on a timer).
 *
 * See backend/src/controllers/orderAdditions.controller.ts.
 */

export type CreateAdditionPaymentResponse = {
  success: boolean;
  request_id: string;
  subtotal_amount: number;
  razorpay_order_id: string;
  amount: number;
  currency: string;
  key_id: string;
  razorpay_mode?: 'test' | 'live';
};

/** Per-call transport options forwarded to `apiFetch` (default timeout 30 s when omitted). */
export type AdditionRequestOptions = {
  /** Request timeout in ms. The screen passes a shorter one than the 30 s default so a stalled gateway setup fails fast. */
  timeoutMs?: number;
};

export async function createAdditionPayment(
  orderId: string,
  items: { product_id: string; quantity: number }[],
  options?: AdditionRequestOptions,
): Promise<CreateAdditionPaymentResponse> {
  return apiFetch<CreateAdditionPaymentResponse>(`/api/orders/${orderId}/add-items/create-payment`, {
    method: 'POST',
    body: JSON.stringify({ items }),
    timeoutMs: options?.timeoutMs,
  });
}

/**
 * Verifies the Razorpay signature for an addition and merges the items
 * server-side. On success the order's memory entries are invalidated
 * (`invalidateOrders`) so the next `getOrderById` / orders-list read shows
 * the added items instead of the 10 s / 20 s cached copy.
 */
export async function verifyAdditionPayment(
  orderId: string,
  payload: {
    request_id: string;
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  },
  options?: AdditionRequestOptions & {
    /** The signed-in user's id — scopes the orders-list invalidation. `null`/omitted invalidates only the single-order entries. */
    userId?: string | null;
  },
): Promise<void> {
  await apiFetch<{ success?: boolean }>(`/api/orders/${orderId}/add-items/verify-payment`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: options?.timeoutMs,
  });
  invalidateOrders(options?.userId ?? null);
}
