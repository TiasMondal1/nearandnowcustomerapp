import { useRazorpay } from '@codearcade/expo-razorpay';
import { useCallback, useRef, useState } from 'react';

import { C } from '../constants/colors';
import { getOrderPaymentStatus } from '../lib/orderService';
import { createPaymentOrder, verifyPayment } from '../lib/razorpayService';

/**
 * Phases in the user-visible online-payment flow.
 *
 * - `idle`              — nothing in flight; render no overlay.
 * - `preparing`         — calling backend `/api/payment/create`. Show "Setting up payment…".
 * - `awaiting_gateway`  — Razorpay sheet is open. Razorpay renders its own UI;
 *                         we still keep the overlay mounted underneath so the
 *                         transition back to "verifying" is seamless.
 * - `verifying`         — calling backend `/api/payment/verify`. Show "Verifying payment…".
 * - `reconciling`       — verify failed; we're polling DB to give the Razorpay
 *                         webhook a chance to settle. Show "Confirming with bank…".
 */
export type PaymentPhase =
  | 'idle'
  | 'preparing'
  | 'awaiting_gateway'
  | 'verifying'
  | 'reconciling';

export type PaymentResult =
  | { status: 'paid' }
  | { status: 'pending'; reason: 'cancelled' | 'failed' | 'verify_failed' | 'unverified'; message?: string }
  | { status: 'error'; message: string };

export interface PayForOrderArgs {
  internalOrderId: string;
  /** Final payable in rupees. Backend uses DB amount as truth, this is a sanity check. */
  amount: number;
  customer: {
    name?: string;
    email?: string;
    phone?: string;
  };
  /** Override default "Order payment" string; useful for retries ("Complete payment for #ABC"). */
  description?: string;
}

const RECONCILE_TIMEOUT_MS = 10_000;
const RECONCILE_INTERVAL_MS = 1_500;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Reusable Razorpay flow used by:
 *   - `app/support/checkout.tsx` (initial order placement)
 *   - `app/(tabs)/orders.tsx` (Pay-now retry from orders list)
 *   - `app/order/[id].tsx`   (Pay-now retry from order detail)
 *
 * Each consumer mounts the returned `RazorpayUI` once in its tree, reads
 * `phase` to render the processing overlay, and calls `payForOrder(...)`.
 */
export function usePaymentFlow() {
  const { openCheckout, closeCheckout, RazorpayUI } = useRazorpay();
  const [phase, setPhase] = useState<PaymentPhase>('idle');
  // Guard against double-firing if user mashes the button — refs are sync
  // unlike state setters, so we can short-circuit immediately.
  const inFlight = useRef(false);

  const reconcile = useCallback(async (orderId: string): Promise<PaymentResult> => {
    setPhase('reconciling');
    const deadline = Date.now() + RECONCILE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const snapshot = await getOrderPaymentStatus(orderId);
      if (snapshot?.payment_status === 'paid') {
        return { status: 'paid' };
      }
      await sleep(RECONCILE_INTERVAL_MS);
    }
    return {
      status: 'pending',
      reason: 'unverified',
      message:
        'We could not confirm your payment yet. If money was debited, it will reflect on your order within a few minutes — or auto-refund within 5–7 days.',
    };
  }, []);

  const payForOrder = useCallback(
    async (args: PayForOrderArgs): Promise<PaymentResult> => {
      if (inFlight.current) {
        return { status: 'error', message: 'A payment is already in progress.' };
      }
      inFlight.current = true;

      try {
        // ─── Phase 1: backend create-order ─────────────────────────────────
        setPhase('preparing');
        let paymentOrder;
        try {
          paymentOrder = await createPaymentOrder(args.internalOrderId, args.amount);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Payment setup failed';
          return { status: 'error', message };
        }

        // ─── Phase 2: open Razorpay sheet, wait for user ───────────────────
        setPhase('awaiting_gateway');
        const gatewayResult = await new Promise<
          | { kind: 'success'; razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }
          | { kind: 'cancelled' }
          | { kind: 'failed'; description?: string }
        >((resolve) => {
          openCheckout(
            {
              key: paymentOrder.key_id,
              amount: paymentOrder.amount,
              currency: paymentOrder.currency,
              order_id: paymentOrder.razorpay_order_id,
              name: 'Near & Now',
              description:
                args.description ??
                (paymentOrder.razorpay_mode === 'test'
                  ? 'Test payment (Razorpay sandbox)'
                  : 'Order payment'),
              prefill: {
                name: args.customer.name || 'Customer',
                email: args.customer.email || '',
                contact: args.customer.phone || '',
              },
              theme: { color: C.primary },
            },
            {
              onSuccess: (response: {
                razorpay_payment_id: string;
                razorpay_order_id: string;
                razorpay_signature: string;
              }) => {
                resolve({
                  kind: 'success',
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_signature: response.razorpay_signature,
                });
              },
              onFailure: (error: { description?: string }) => {
                resolve({ kind: 'failed', description: error?.description });
              },
              onClose: () => {
                // Native sheet was dismissed without success/failure firing.
                // We bias toward "cancelled" — Razorpay always fires success/failure
                // first when payment actually completes.
                resolve({ kind: 'cancelled' });
              },
            },
          );
        });

        // Belt-and-suspenders: if the sheet stays mounted for some reason, force-close it.
        closeCheckout?.();

        if (gatewayResult.kind === 'cancelled') {
          return { status: 'pending', reason: 'cancelled' };
        }
        if (gatewayResult.kind === 'failed') {
          return {
            status: 'pending',
            reason: 'failed',
            message: gatewayResult.description || 'Payment could not be completed.',
          };
        }

        // ─── Phase 3: backend verify ───────────────────────────────────────
        setPhase('verifying');
        try {
          await verifyPayment({
            paymentId: gatewayResult.razorpay_payment_id,
            razorpayOrderId: gatewayResult.razorpay_order_id,
            signature: gatewayResult.razorpay_signature,
            internalOrderId: args.internalOrderId,
          });
          return { status: 'paid' };
        } catch (err: unknown) {
          // Verify failed — but the webhook may settle this. Reconcile.
          console.warn('[PAYMENT] verify failed; reconciling', err);
          return await reconcile(args.internalOrderId);
        }
      } finally {
        inFlight.current = false;
        setPhase('idle');
      }
    },
    [openCheckout, closeCheckout, reconcile],
  );

  return { phase, payForOrder, RazorpayUI };
}
