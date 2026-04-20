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
 */

/** Internal rail that the order will actually run on. */
export type PaymentMode = "upi" | "cod";

/** Razorpay's `prefill.method` — lets us preselect the tab inside the sheet. */
export type RazorpayMethod = "upi" | "card" | "netbanking" | "wallet" | "emi";

export type PaymentSelection = {
  mode: PaymentMode;
  /** Headline text, e.g. "UPI", "Card", "Cash on Delivery". */
  label: string;
  /** Optional small line below. */
  subLabel?: string;
  /** Material Community icon name for the pay-row chip. */
  icon?: string;
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

const DEFAULT: PaymentSelection = {
  mode: "upi",
  label: "Pay by UPI / Card",
  subLabel: "Secured by Razorpay",
  icon: "credit-card-outline",
};

let current: PaymentSelection = DEFAULT;
const listeners = new Set<(v: PaymentSelection) => void>();

export function getPaymentSelection(): PaymentSelection {
  return current;
}

export function setPaymentSelection(next: PaymentSelection): void {
  current = next;
  for (const cb of listeners) cb(current);
}

export function subscribePaymentSelection(
  cb: (v: PaymentSelection) => void,
): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function resetPaymentSelection(): void {
  setPaymentSelection(DEFAULT);
}
