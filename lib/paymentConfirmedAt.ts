/**
 * When checkout saw an order's online / wallet payment succeed, in memory.
 *
 * The confirmation screen's "Forgot something?" countdown was anchored to the
 * order's `created_at`. An online order is created before the Razorpay sheet
 * opens, so a payment that took longer than the 30 s window (a UPI app
 * hand-off often does) arrived with the window already closed. The backend now
 * opens its window at `customer_payments.paid_at`
 * (orderAdditions.controller.ts); this is the app's copy of that moment.
 *
 * Memory only, on purpose: after an app restart the countdown falls back to
 * `created_at`, and the server — the authority on the window — still decides.
 * (2026-10-27)
 */
const confirmedAt = new Map<string, number>();

/** Call right after a payment for `orderId` is confirmed. */
export function notePaymentConfirmed(orderId: string, at: number = Date.now()): void {
  confirmedAt.set(orderId, at);
}

/** When checkout saw `orderId` paid in this session, or undefined. */
export function paymentConfirmedAt(orderId: string): number | undefined {
  return confirmedAt.get(orderId);
}
