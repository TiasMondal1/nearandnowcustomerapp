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
