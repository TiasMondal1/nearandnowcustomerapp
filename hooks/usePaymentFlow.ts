import { useRazorpay } from '@codearcade/expo-razorpay';
import { useCallback, useEffect, useRef, useState } from 'react';

import { C } from '../constants/colors';
import { getDevFlag } from '../lib/devFlags';
import { logSilentFailure } from '../lib/logSilentFailure';
import { getOrderPaymentStatus, invalidateOrders } from '../lib/orderService';
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
  /** Override default "Order payment" string; useful for retries ("Complete payment for order NN-1234"). */
  description?: string;
  /**
   * Pre-selects the tab inside the Razorpay sheet. Use "upi", "card",
   * "netbanking", "wallet", or "emi". If omitted, the sheet opens on its
   * default tab (usually the last-used method for the customer).
   */
  preferredMethod?: 'upi' | 'card' | 'netbanking' | 'wallet' | 'emi';
  /**
   * Optional extra (2026-10-03): the signed-in user's id. When a payment
   * resolves `paid` the orders list for this user is invalidated in memory
   * (`invalidateOrders`) so the next Orders/Home read sees `payment_status`
   * change instead of a 20 s stale cache. Without it only the single-order
   * entries are invalidated.
   */
  userId?: string | null;
}

const RECONCILE_TIMEOUT_MS = 10_000;
const RECONCILE_INTERVAL_MS = 1_500;
/**
 * Per-poll ceiling while reconciling. `apiFetch` defaults to 30 s, which is
 * longer than the whole reconcile window; `getOrderPaymentStatus` does not yet
 * forward `{ timeoutMs }` (lib/orderService.ts is not ours to edit — reported),
 * so the poll is raced against this timer and a late answer is treated like
 * the service's own "null = unknown" result.
 */
const POLL_TIMEOUT_MS = 8_000;
/** The "Setting up payment…" beat the dev seam shows before resolving. */
const SIMULATED_PREPARING_MS = 600;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Resolves `fallback` if `promise` has not settled within `ms` (the promise itself keeps running). */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// ─── Phase mirror (CONTRACTS §2.22) ───────────────────────────────────────────
// Module-level copy of the mounted flow's phase for non-React readers: the
// DevPill hides while `getPaymentPhaseSync() !== 'idle'`. Written only by the
// hook's `setPhase` wrapper; reset to 'idle' when the writing instance unmounts.
// Consumers of the mirror play no feedback (it is observation, not a gesture).

let currentPhase: PaymentPhase = 'idle';
/** Which mounted hook instance wrote the mirror last — an unmounting sibling never clobbers an in-flight flow. */
let phaseOwner = 0;
let instanceSeq = 0;
const phaseSubscribers = new Set<() => void>();

function writePhase(next: PaymentPhase, owner: number): void {
  if (next !== 'idle') {
    phaseOwner = owner;
  } else if (phaseOwner !== owner) {
    // Another instance owns the live phase; ignore this one's idle.
    return;
  }
  if (currentPhase === next) return;
  currentPhase = next;
  phaseSubscribers.forEach((cb) => cb());
}

/** Sync phase for non-React readers; 'idle' when no flow is mounted. */
export function getPaymentPhaseSync(): PaymentPhase {
  return currentPhase;
}

/** Subscribe to phase changes (useSyncExternalStore-compatible); returns the unsubscribe. */
export function subscribePaymentPhase(cb: () => void): () => void {
  phaseSubscribers.add(cb);
  return () => {
    phaseSubscribers.delete(cb);
  };
}

/**
 * Reusable Razorpay flow used by:
 *   - `app/support/checkout.tsx` (initial order placement)
 *   - `app/(tabs)/orders.tsx` (Pay-now retry from orders list)
 *   - `app/order/[id].tsx`   (Pay-now retry from order detail)
 *
 * Each consumer mounts the returned `RazorpayUI` once in its tree, reads
 * `phase` to render the processing overlay, and calls `payForOrder(...)`.
 *
 * Dev seams (lib/devFlags.ts, read at call time — no restart):
 *   - `Dev_Payment_inhibit_GatewayResult` (off | paid | failed | cancelled | unverified):
 *     anything but `off` short-circuits `payForOrder` WITHOUT calling
 *     `/api/payment/create` or opening Razorpay and resolves the forced result
 *     after the overlay delay. A forced `paid` does NOT mark the backend order
 *     paid — the confirmation screen shows the payment as pending; that is
 *     expected and lets the success path be exercised without a gateway.
 *   - `Dev_Payment_inhibit_OverlayDelayMs` (0–60000): holds the overlay in
 *     `verifying` for that long — in the forced path after the "preparing"
 *     beat, in the real path right before `/api/payment/verify` — so the
 *     15 s "Taking longer than usual" escalation can be seen.
 */
export function usePaymentFlow() {
  const { openCheckout, closeCheckout, RazorpayUI } = useRazorpay();
  const [phase, setPhaseState] = useState<PaymentPhase>('idle');
  // Guard against double-firing if user mashes the button — refs are sync
  // unlike state setters, so we can short-circuit immediately.
  const inFlight = useRef(false);
  // Identity of this hook instance for the phase mirror (assigned on mount).
  const instanceId = useRef(0);

  useEffect(() => {
    instanceId.current = ++instanceSeq;
    const id = instanceId.current;
    return () => {
      // Reset to 'idle' on unmount (CONTRACTS §2.22) — only if we own the mirror.
      writePhase('idle', id);
    };
  }, []);

  /** React state + module mirror in one write. */
  const setPhase = useCallback((next: PaymentPhase) => {
    setPhaseState(next);
    writePhase(next, instanceId.current);
  }, []);

  const reconcile = useCallback(
    async (orderId: string): Promise<PaymentResult> => {
      setPhase('reconciling');
      const deadline = Date.now() + RECONCILE_TIMEOUT_MS;
      while (Date.now() < deadline) {
        // 8 s ceiling per poll (CONTRACTS §2.4: "polls pass 8000").
        const snapshot = await withTimeout(getOrderPaymentStatus(orderId), POLL_TIMEOUT_MS, null);
        if (snapshot?.payment_status === 'paid') {
          return { status: 'paid' };
        }
        // Razorpay's payment.failed webhook can flip this to 'failed' mid-poll
        // (backend/src/services/payment.service.ts's processWebhookEvent) —
        // that's a terminal answer, no reason to keep polling out the full window.
        if (snapshot?.payment_status === 'failed') {
          return {
            status: 'pending',
            reason: 'failed',
            message: 'Your payment could not be completed. If any amount was debited, it will be auto-refunded within 5–7 days.',
          };
        }
        await sleep(RECONCILE_INTERVAL_MS);
      }
      return {
        status: 'pending',
        reason: 'unverified',
        message:
          'We could not confirm your payment yet. If money was debited, it will reflect on your order within a few minutes — or auto-refund within 5–7 days.',
      };
    },
    [setPhase],
  );

  const payForOrder = useCallback(
    async (args: PayForOrderArgs): Promise<PaymentResult> => {
      if (inFlight.current) {
        return { status: 'error', message: 'A payment is already in progress.' };
      }
      inFlight.current = true;

      try {
        // ─── Dev seam: forced gateway result ───────────────────────────────
        // Short-circuits BEFORE /api/payment/create — nothing reaches Razorpay
        // or the backend. NOTE: a forced 'paid' does NOT mark the backend order
        // paid; the confirmation shows the payment as pending (by design).
        const forced = getDevFlag('Dev_Payment_inhibit_GatewayResult');
        if (forced !== 'off') {
          setPhase('preparing');
          await sleep(SIMULATED_PREPARING_MS);
          const hold = getDevFlag('Dev_Payment_inhibit_OverlayDelayMs');
          if (hold > 0) {
            // Hold in 'verifying' (not 'preparing') so the overlay's 15 s
            // escalation — which counts verifying|reconciling only — is
            // reachable with GatewayResult + OverlayDelayMs = 16000 and no gateway.
            setPhase('verifying');
            await sleep(hold);
          }
          setPhase('idle');
          return forced === 'paid'
            ? { status: 'paid' }
            : { status: 'pending', reason: forced, message: 'Simulated by the dev panel' };
        }

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
                // Pre-selects the tab inside the Razorpay sheet so the user
                // lands on the rail they picked on the payment-options screen.
                ...(args.preferredMethod ? { method: args.preferredMethod } : {}),
              },
              // Ask Razorpay to remember the customer's saved cards / UPI
              // VPAs. Combined with a server-side `customer_id`, this is what
              // makes the "Preferred Payment" list build up over time.
              remember_customer: true,
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
        // Dev seam: hold the overlay here so the 15 s escalation can be exercised
        // against a real (sandbox) payment too.
        const verifyHold = getDevFlag('Dev_Payment_inhibit_OverlayDelayMs');
        if (verifyHold > 0) await sleep(verifyHold);
        try {
          await verifyPayment({
            paymentId: gatewayResult.razorpay_payment_id,
            razorpayOrderId: gatewayResult.razorpay_order_id,
            signature: gatewayResult.razorpay_signature,
            internalOrderId: args.internalOrderId,
          });
          // payment_status changed server-side: drop the 10 s / 20 s memory
          // entries so Orders / Home / confirmation read it fresh.
          invalidateOrders(args.userId ?? null);
          return { status: 'paid' };
        } catch (err: unknown) {
          // Verify failed — but the webhook may settle this. Reconcile.
          logSilentFailure('[PAYMENT] verify', err);
          const settled = await reconcile(args.internalOrderId);
          if (settled.status === 'paid' || (settled.status === 'pending' && settled.reason === 'failed')) {
            // The webhook moved payment_status while we polled.
            invalidateOrders(args.userId ?? null);
          }
          // The verify call itself rejected AND the reconcile window ran out: 'verify_failed' (distinct from a
          // payment that was simply never verified) so checkout can show the debit/refund copy (W3 R2-12).
          if (settled.status === 'pending' && settled.reason === 'unverified') {
            return { status: 'pending', reason: 'verify_failed', message: settled.message };
          }
          return settled;
        }
      } finally {
        inFlight.current = false;
        setPhase('idle');
      }
    },
    [openCheckout, closeCheckout, reconcile, setPhase],
  );

  return { phase, payForOrder, RazorpayUI };
}
