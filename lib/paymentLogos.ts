/**
 * Bundled brand marks for the checkout payment-options list / pay-dock chip.
 * Assets live in `assets/payment/` — keep filenames stable; Metro resolves
 * `require()` at bundle time.
 */
export const PAYMENT_LOGOS = {
  gpay: require("../assets/payment/logo-gpay.png"),
  phonepe: require("../assets/payment/logo-phonepe.png"),
  paytm: require("../assets/payment/logo-paytm.png"),
  cred: require("../assets/payment/logo-cred.png"),
  bhim: require("../assets/payment/logo-bhim.png"),
  upi: require("../assets/payment/logo-upi.png"),
  /** The Near & Now wallet — the app's own rounded icon, drawn full-size (no white tile behind it). */
  wallet: require("../assets/brand/icon-rounded-128.png"),
} as const;

export type PaymentLogoKey = keyof typeof PAYMENT_LOGOS;
