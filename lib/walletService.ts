import { apiFetch } from './apiClient';
import { getDevFlag } from './devFlags';
import { cached, invalidate, peek, QC_KEYS, setCached } from './queryCache';

/**
 * Client for the customer wallet — a real stored-value balance, not the
 * previous fully-fake shell (hardcoded ₹0.00, "Add Money" just showed an
 * alert). Backend: near-and-now/backend/src/{controllers,routes}/wallet.*.ts,
 * migration 20260910000000_customer_wallet.sql.
 */

/** Balance memory TTL — short because checkout / top-up change it; both write through `setCached`. */
const WALLET_BALANCE_TTL_MS = 30_000;
const BALANCE_CACHE_OPTS = { ttlMs: WALLET_BALANCE_TTL_MS, userScope: true } as const;

export interface WalletTopupOrder {
  razorpay_order_id: string;
  amount: number; // paise
  currency: string;
  key_id: string;
  razorpay_mode?: 'test' | 'live';
}

async function fetchWalletBalance(): Promise<number> {
  const res = await apiFetch<{ success: boolean; balance: number }>('/api/wallet');
  return Number(res?.balance ?? 0);
}

/**
 * Wallet balance in rupees. `cached(QC_KEYS.walletBalance, 30 s, userScope)`;
 * `force` (pull-to-refresh / focus revalidate) skips memory.
 * `Dev_Wallet_inhibit_FakeBalance >= 0` resolves that value with no network
 * (and seeds the cache so `peekWalletBalance()` agrees). Rejects on a real error.
 */
export async function getWalletBalance(opts?: { force?: boolean }): Promise<number> {
  const fake = getDevFlag('Dev_Wallet_inhibit_FakeBalance');
  if (fake >= 0) {
    setCached(QC_KEYS.walletBalance, fake, BALANCE_CACHE_OPTS);
    return fake;
  }
  return cached<number>(QC_KEYS.walletBalance, fetchWalletBalance, {
    ...BALANCE_CACHE_OPTS,
    force: opts?.force,
  });
}

/** Synchronous memory read for first paint (may be stale beyond 30 s); `undefined` before the first fetch. */
export function peekWalletBalance(): number | undefined {
  return peek<number>(QC_KEYS.walletBalance);
}

/** Drops the memory entry so the next `getWalletBalance()` hits the network. */
export function invalidateWalletBalance(): void {
  invalidate(QC_KEYS.walletBalance);
}

export interface WalletTransaction {
  id: string;
  type: 'credit' | 'debit';
  reason: 'topup' | 'order_payment' | 'refund';
  amount: number;
  balance_after: number;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
}

/** One page of transactions (default 20 from offset 0), newest first. `[]` under `Dev_Wallet_inhibit_Transactions`. */
export async function getWalletTransactions(limit = 20, offset = 0): Promise<WalletTransaction[]> {
  if (getDevFlag('Dev_Wallet_inhibit_Transactions')) return [];
  const res = await apiFetch<{ success: boolean; transactions: WalletTransaction[] }>(
    `/api/wallet/transactions?limit=${limit}&offset=${offset}`,
  );
  return res?.transactions ?? [];
}

export async function createWalletTopupOrder(amountRupees: number): Promise<WalletTopupOrder> {
  return apiFetch<WalletTopupOrder>('/api/wallet/topup/create', {
    method: 'POST',
    body: JSON.stringify({ amount: amountRupees }),
  });
}

/** Confirms a Razorpay top-up; resolves the new balance and writes it straight into the cache. */
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
  const balance = Number(res?.balance ?? 0);
  setCached(QC_KEYS.walletBalance, balance, BALANCE_CACHE_OPTS);
  return balance;
}

/**
 * Pays an already-created, still-pending order out of the wallet balance.
 * Throws (via apiFetch) on insufficient balance or any other failure — the
 * caller should treat this exactly like a failed Razorpay attempt (order is
 * already saved, retry later with a different method). On success the new
 * balance is written into the cache.
 */
export async function payOrderWithWallet(orderId: string): Promise<number> {
  const res = await apiFetch<{ success: boolean; balance: number }>('/api/wallet/pay-order', {
    method: 'POST',
    body: JSON.stringify({ orderId }),
  });
  const balance = Number(res?.balance ?? 0);
  setCached(QC_KEYS.walletBalance, balance, BALANCE_CACHE_OPTS);
  return balance;
}

/** `Dev_Wallet_inhibit_TopupGateway`: the wallet screen skips Razorpay and fakes the verify step (balance + amount). */
export function isTopupGatewayInhibited(): boolean {
  return getDevFlag('Dev_Wallet_inhibit_TopupGateway');
}
