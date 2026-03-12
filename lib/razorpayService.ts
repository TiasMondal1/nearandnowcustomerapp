import { apiFetch } from './apiClient';

export interface CreateRazorpayOrderResponse {
  order_id: string;
}

/**
 * Creates a Razorpay order on the backend. The backend uses the Razorpay secret key
 * to create the order. Amount must be in paise (e.g. ₹100 = 10000 paise).
 */
export async function createRazorpayOrder(
  amountPaise: number,
  receipt?: string,
): Promise<CreateRazorpayOrderResponse> {
  const result = await apiFetch<CreateRazorpayOrderResponse>(
    '/api/razorpay/create-order',
    {
      method: 'POST',
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: receipt ?? `order_${Date.now()}`,
      }),
    },
  );
  return result;
}
