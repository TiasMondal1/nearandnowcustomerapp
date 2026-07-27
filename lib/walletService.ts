import { apiFetch } from './apiClient';

/**
 * Client for the customer wallet — a real stored-value balance, not the
 * previous fully-fake shell (hardcoded ₹0.00, "Add Money" just showed an
 * alert). Backend: near-and-now/backend/src/{controllers,routes}/wallet.*.ts,
 * migration 20260910000000_customer_wallet.sql.
 */

export interface WalletTopupOrder {
  razorpay_order_id: string;
  amount: number; // paise
  currency: string;
  key_id: string;
  razorpay_mode?: 'test' | 'live';
}

export async function getWalletBalance(): Promise<number> {
  const res = await apiFetch<{ success: boolean; balance: number }>('/api/wallet');
  return Number(res?.balance ?? 0);
}

export async function createWalletTopupOrder(amountRupees: number): Promise<WalletTopupOrder> {
  return apiFetch<WalletTopupOrder>('/api/wallet/topup/create', {
    method: 'POST',
    body: JSON.stringify({ amount: amountRupees }),
  });
}

export async function verifyWalletTopup(payload: {
  paymentId: string;
  razorpayOrderId: string;
  signature: string;
  amount: number; // rupees, matches the order that was created
}): Promise<number> {
  const res = await apiFetch<{ success: boolean; balance: number }>('/api/wallet/topup/verify', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return Number(res?.balance ?? 0);
}

/**
 * Pays an already-created, still-pending order out of the wallet balance.
 * Throws (via apiFetch) on insufficient balance or any other failure — the
 * caller should treat this exactly like a failed Razorpay attempt (order is
 * already saved, retry later with a different method).
 */
export async function payOrderWithWallet(orderId: string): Promise<number> {
  const res = await apiFetch<{ success: boolean; balance: number }>('/api/wallet/pay-order', {
    method: 'POST',
    body: JSON.stringify({ orderId }),
  });
  return Number(res?.balance ?? 0);
}
