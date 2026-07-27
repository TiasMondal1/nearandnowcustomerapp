import { apiFetch } from './apiClient';

/**
 * Backend for the confirmation screen's 30-second "add more items" window —
 * merges items added during that window into the just-placed order (same
 * store trip, same delivery) instead of them becoming a separate purchase.
 * The original order's payment is untouched; added items get their own,
 * separate Razorpay charge for just the delta.
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

export async function createAdditionPayment(
  orderId: string,
  items: Array<{ product_id: string; quantity: number }>,
): Promise<CreateAdditionPaymentResponse> {
  return apiFetch<CreateAdditionPaymentResponse>(`/api/orders/${orderId}/add-items/create-payment`, {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

export async function verifyAdditionPayment(
  orderId: string,
  payload: {
    request_id: string;
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  },
): Promise<void> {
  await apiFetch<{ success?: boolean }>(`/api/orders/${orderId}/add-items/verify-payment`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
