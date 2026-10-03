// codename: cinder
// Checkout IS the cart (DECISIONS D5 · design/blinkit-parity §3.7 / BP-17 / BP-18 / BP-35 · motion M19 / M32 / M33).
// One flat white page on the owner's 8 px band pattern: titled header ("Cart · N items · Delivery in 12 min"), the
// item rows with the shared Stepper (remove at min → Undo toast), the price-drift row (kepler), the
// "Did you forget?" strip + Offers row (W2-checkout-plumbing, composed by their frozen props), the bill with
// sheet-based fee info, tip chips capped at ₹500, GSTIN / "order for" / instructions on underline Inputs with
// INLINE validation (Pay never bounces to an Alert), the aligned policy note, and a pay dock that carries the sticky
// address block, the helper line and the method selector + pay button. The dock lifts with the Android keyboard.
//
// Payment invariants (MAP §7.16) are preserved in intent: the order row exists BEFORE payment, cancel/fail actively
// void it, `verify_failed`/`unverified` keep it and clear the cart, `placingRef` is the synchronous double-tap lock,
// `navigatingAwayRef` (+ its state twin) is set BEFORE `clearCart()`, `goToOrderConfirmation` is dismiss-to-home-
// then-push (Home is the one route under the confirmation — W3 R6-RR-1), and `RazorpayUI` is mounted here. Checkout fires NO success feedback — the confirmation screen is the single
// owner of the success haptic + chime (CONTRACTS §8); this screen plays `error` on cancel / fail / validation only.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type KeyboardEvent,
  type LayoutChangeEvent,
  type TextInput,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { AddressBlock } from "../../components/checkout/AddressBlock";
import { BillSection } from "../../components/checkout/BillSection";
import { DidYouForgetStrip } from "../../components/checkout/DidYouForgetStrip";
import { ItemsSection } from "../../components/checkout/ItemsSection";
import { OffersRow } from "../../components/checkout/OffersRow";
import { OrderForSection, type OrderForValue, type ReceiverField } from "../../components/checkout/OrderForSection";
import { PayDock, type PayDockHelper } from "../../components/checkout/PayDock";
import { TipSection, type TipPreset } from "../../components/checkout/TipSection";
import { PaymentProcessingOverlay } from "../../components/PaymentProcessingOverlay";
import {
  ChevronRotate,
  Collapsible,
  dismissToast,
  dur,
  ease,
  EmptyState,
  IconButton,
  IconWrap,
  Input,
  ListRow,
  notify,
  PressableScale,
  Screen,
  ScreenHeader,
  Skeleton,
  SkeletonScreen,
  useDockHeight,
  useMotionReduced,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { calcOrderTotal, DELIVERY_FEE_WAS } from "../../constants/fees";
import { fontFamily, motion, radius } from "../../constants/ui";
import { useAuth } from "../../context/AuthContext";
import { cartActions, getCartSnapshot, useCart, type CartItem, type PriceDrift } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";
import { useDeliveryEta } from "../../hooks/useDeliveryEta";
import { useIsOnline } from "../../hooks/useIsOnline";
import { usePaymentFlow } from "../../hooks/usePaymentFlow";
import { useForceSkeleton } from "../../hooks/useSlowLoad";
import { getDevFlag, useDevFlag } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import { formatMoney } from "../../lib/formatMoney";
import { GSTIN_EXAMPLE, gstinHint, gstinProblem, isValidGstin, normalizeGstin } from "../../lib/gstin";
import { logError } from "../../lib/logError";
import { logSilentFailure } from "../../lib/logSilentFailure";
import { markOrderPlaced } from "../../lib/orderHistoryFlag";
import { cancelOrder, createOrder, invalidateOrders, type Order } from "../../lib/orderService";
import { getPaymentSelection, subscribePaymentSelection } from "../../lib/paymentSelection";
import { getCachedProduct } from "../../lib/productService";
import { clearSavedPaymentMethodsCache } from "../../lib/razorpayService";
import { useGstinVerification } from "../../lib/useGstinVerification";
import { getWalletBalance, payOrderWithWallet, peekWalletBalance } from "../../lib/walletService";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Tip ceiling (C36): anything above is clamped on blur with a shake + "Max ₹500". */
const TIP_CAP = 500;
const PHONE_LENGTH = 10;
const GSTIN_LENGTH = 15;
const OFFLINE_HELPER = "Connect to the internet to place your order";
/** C35 — the same sentence the support FAQ uses, so the two surfaces no longer contradict each other. */
const POLICY_COPY = "Orders can be cancelled until the store accepts them. After that, contact support and we'll help.";
/** A line that vanished within this window of the last USER mutation is a removal the user made (→ Undo toast). */
const REMOVE_TOAST_WINDOW_MS = 1500;
/** "Clear cart" toasts itself; the per-line diff stays quiet for this long after it. */
const CLEAR_SUPPRESS_MS = 600;
/** Focus the offending field once the scroll-to has settled. */
const FOCUS_AFTER_SCROLL_MS = 260;
const LINK_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 12 } as const;
const SKELETON_ROWS = [0, 1, 2] as const;
const SKELETON_BILL_ROWS = [0, 1, 2, 3] as const;

type FieldKey = "address" | "receiverName" | "receiverPhone" | "gstin" | "invoiceName";
type SectionKey = "tip" | "gstin" | "orderFor" | "instructions";
type Problem = { field: FieldKey; summary: string; alertTitle: string; alertMessage: string };

/** Which scrollable section hosts each validation target (the address strip lives in the dock → no scroll). */
const SECTION_FOR_FIELD: Record<FieldKey, SectionKey | null> = {
  address: null,
  receiverName: "orderFor",
  receiverPhone: "orderFor",
  gstin: "gstin",
  invoiceName: "gstin",
};
const ZERO_SHAKES: Record<FieldKey, number> = { address: 0, receiverName: 0, receiverPhone: 0, gstin: 0, invoiceName: 0 };
const UNTOUCHED: Record<FieldKey, boolean> = { address: false, receiverName: false, receiverPhone: false, gstin: false, invoiceName: false };

/**
 * Every payment path (COD, wallet, Razorpay) lands here once the order is
 * genuinely committed. Unwinding to home *before* pushing confirmation —
 * rather than replacing checkout with confirmation directly — means whatever
 * screen sits below confirmation/track in the stack is always home, so backing
 * out of tracking lands on home (with its active-orders banner) instead of
 * wherever checkout happened to be pushed from.
 *
 * `dismissTo`, not `replace` (W3 R6-RR-1): checkout is pushed above the live
 * `(tabs)`, and REPLACE swaps only the focused route, so it left
 * [(tabs), (tabs), confirmation] — two Home navigators mounted, and the
 * confirmation's own `dismissTo("/(tabs)/home")` stopped at the duplicate.
 * POP_TO pops checkout back to the live tabs (merging { screen: "home" }); from
 * a cold deep link straight into checkout it replaces instead, so the end state
 * is [(tabs), confirmation] either way.
 */
function goToOrderConfirmation(orderId: string): void {
  // The "Cart cleared · Undo" toast must not survive into the confirmation (W3 R2-18); per-line toasts are guarded.
  dismissToast("cart-cleared");
  router.dismissTo("/(tabs)/home");
  router.push(`/order/confirmation/${orderId}`);
}

/**
 * The two order-placement failures that keep a native Alert (W3 R2-F6 — kept on purpose): "verify your email" is a
 * confirmation that navigates to the profile, and a generic backend rejection ("Product(s) not available from any
 * store near you: <item, item, …>") carries a long, item-specific message that a toast would clamp to two lines —
 * it must stay readable in full so the customer knows which rows to fix.
 */
function showOrderFailure(message: string): void {
  if (message.toLowerCase().includes("verify your email")) {
    // Sanctioned Alert (W3 F8): unrecoverable error / blocking requirement — not a toast.
    Alert.alert("Email verification required", message, [
      { text: "Verify now", onPress: () => router.push("/settings/profile") },
      { text: "Cancel", style: "cancel" },
    ]);
    return;
  }
  // Sanctioned Alert (W3 F8): unrecoverable error / blocking requirement — not a toast.
  Alert.alert("Order failed", `${message}\n\nYour cart is safe — please try again.`);
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CheckoutScreen() {
  const { items, isHydrated, subtotal, totalQty, itemCount, appliedCoupon, discount, isCouponEligible } = useCart();
  const { user, customer } = useAuth();
  const { location, locationKey } = useLocation();
  const eta = useDeliveryEta();
  const online = useIsOnline();
  const cobaltOff = useDevFlag("Dev_Cobalt_inhibit_Feature");
  const dockHeight = useDockHeight();
  const reduced = useMotionReduced();
  // The screen deliberately does NOT subscribe to the payment selection: the dock's two leaves do (PayDock), and
  // placeOrder reads it synchronously — a selection change must never re-render this whole tree.
  const { phase: paymentPhase, payForOrder, RazorpayUI } = usePaymentFlow();

  const [placing, setPlacing] = useState(false);
  // The order being paid online / by wallet, for the processing overlay's "Need help?" link (null otherwise).
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  // Synchronous lock, checked/set before any React re-render — `placing` state
  // alone isn't enough to stop a fast double-tap, since the button doesn't
  // actually re-render as disabled until after the first tap's state update
  // commits, leaving a window where a second tap can still fire placeOrder().
  const placingRef = useRef(false);
  // Set right before any clearCart() that's followed by an intentional
  // away-navigation (confirmation, /orders). clearCart() re-renders this
  // still-mounted screen with items.length === 0, which would otherwise show
  // the empty state (and used to redirect Home) and race the real navigation.
  // `navigatingAway` is its state twin for JSX — refs are never read in render.
  const navigatingAwayRef = useRef(false);
  const [navigatingAway, setNavigatingAway] = useState(false);

  // ─── GSTIN ───
  const [gstinClaim, setGstinClaim] = useState(false);
  const [gstin, setGstin] = useState("");
  const [invoiceName, setInvoiceName] = useState("");
  // Live registry check once the GSTIN is well-formed (2026-10-02). An Active
  // GSTIN fills in the registered legal name — what the backend saves and
  // prints on the invoice anyway.
  const gstinCheck = useGstinVerification(normalizeGstin(gstin), gstinClaim && isValidGstin(gstin));
  useEffect(() => {
    if (gstinCheck.state === "verified" && gstinCheck.legalName) setInvoiceName(gstinCheck.legalName);
  }, [gstinCheck]);

  // ─── Tip / instructions / receiver ───
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [tipPreset, setTipPreset] = useState<TipPreset | null>(null);
  const [customTip, setCustomTip] = useState("");
  const [tipError, setTipError] = useState<string | null>(null);
  const [thanksNonce, setThanksNonce] = useState(0);
  // Who is this order for? Captured here (not on the saved address) so the
  // same address can serve both self-delivery and "ordering for someone else".
  const [orderFor, setOrderFor] = useState<OrderForValue>("self");
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [receiverAddress, setReceiverAddress] = useState("");

  // ─── Validation state (M32) ───
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<Record<FieldKey, boolean>>(UNTOUCHED);
  const [shakes, setShakes] = useState<Record<FieldKey, number>>(ZERO_SHAKES);
  const [walletHint, setWalletHint] = useState<string | null>(null);

  // ─── Price drift (kepler) ───
  const [drift, setDrift] = useState<PriceDrift[]>([]);
  const [driftDismissed, setDriftDismissed] = useState(false);

  // ─── Refs ───
  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Record<SectionKey, number>>({ tip: 0, gstin: 0, orderFor: 0, instructions: 0 });
  const focusedSectionRef = useRef<SectionKey | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevItemsRef = useRef<CartItem[]>(items);
  const suppressRemoveToastUntilRef = useRef(0);
  const dockWrapRef = useRef<View>(null);
  const gstinRef = useRef<TextInput>(null);
  const invoiceNameRef = useRef<TextInput>(null);
  const receiverNameRef = useRef<TextInput>(null);
  const receiverPhoneRef = useRef<TextInput>(null);
  const tipRef = useRef<TextInput>(null);

  // ─── Keyboard-safe dock (U32) ───
  const [kbLift, setKbLift] = useState(0);
  const dockLift = useSharedValue(0);
  const dockLiftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dockLift.get() }] }));

  // ─── Money (math unchanged: constants/fees.ts is a backend mirror) ───
  const { platformFee, handlingFee, deliveryFee, projected } = useMemo(
    // calcOrderTotal's distanceKm param is unused (delivery is a flat ₹0 — see
    // constants/fees.ts); this screen used to run an extra per-cart-change
    // Supabase query (a batch product-to-store distance lookup, since deleted)
    // purely to compute a value that fed into it and was then ignored. Removed
    // 2026-09-09 — matches how payment-options.tsx calls this (no real distance).
    () => calcOrderTotal(subtotal, totalQty),
    [subtotal, totalQty],
  );
  const baseFinalPayable = Math.max(projected - discount, 0);
  const tipAmount = useMemo(() => {
    if (!tipPreset) return 0;
    if (tipPreset === "custom") {
      // Digits only (number-pad), so the tip is already a whole rupee (C36); the cap is applied for the totals
      // even before the blur clamps the field.
      const parsed = parseInt(customTip, 10);
      return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), TIP_CAP) : 0;
    }
    return tipPreset;
  }, [tipPreset, customTip]);
  // The ONE rounding: pay button, order_total and the Razorpay amount all read this integer (C36).
  const finalPayable = Math.round(baseFinalPayable + tipAmount);

  const cartSig = useMemo(() => items.map((i) => i.product_id).sort().join(","), [items]);
  const offlineBlocked = !online && !cobaltOff;
  const subtitle = [
    `${itemCount} ${itemCount === 1 ? "item" : "items"}`,
    eta.state === "open" && eta.minutes != null ? `Delivery in ${eta.minutes} min` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // ─── Price drift: on mount, on hydration and on every focus (kepler) ───
  const revalidatePrices = useCallback(() => {
    if (!getCartSnapshot().isHydrated) return;
    const drifts = cartActions.revalidatePrices((id) => getCachedProduct(id)?.price);
    if (drifts.length > 0) {
      setDrift(drifts);
      setDriftDismissed(false);
    }
  }, []);
  useFocusEffect(revalidatePrices);
  // The wallet-shortfall helper is stale the moment the method changes or the user returns (from /wallet with a
  // top-up, say); it used to stick until the next Pay tap (W3 R2-08).
  useEffect(() => subscribePaymentSelection((s) => { if (s.mode !== "wallet") setWalletHint(null); }), []);
  useFocusEffect(useCallback(() => { setWalletHint(null); }, []));
  useEffect(() => {
    if (isHydrated) revalidatePrices();
  }, [isHydrated, revalidatePrices]);

  // ─── Per-line removal → Undo toast (M33). The Stepper removes through CartContext; the screen only watches. ───
  useEffect(() => {
    const prev = prevItemsRef.current;
    prevItemsRef.current = items;
    if (prev === items || navigatingAwayRef.current) return;
    if (Date.now() < suppressRemoveToastUntilRef.current) return;
    const currentIds = new Set(items.map((i) => i.product_id));
    const removed = prev.filter((line) => !currentIds.has(line.product_id));
    // Exactly one line gone = a trash tap / "−" at the minimum; batches are Clear cart (toasted there) or logout.
    if (removed.length !== 1) return;
    if (Date.now() - getCartSnapshot().lastUserMutationAt > REMOVE_TOAST_WINDOW_MS) return;
    const line = removed[0];
    const noUndo = getDevFlag("Dev_Cinder_inhibit_UndoRemove") || getDevFlag("Dev_Cinder_inhibit_Feature");
    notify({
      id: `removed-${line.product_id}`,
      title: `Removed ${line.name}`,
      action: noUndo
        ? undefined
        : {
            label: "Undo",
            onPress: () => {
              // The toast outlives placement: never re-insert into the empty post-order cart (W3 R2-18).
              if (!navigatingAwayRef.current) cartActions.restoreItem(line, { silent: true });
            },
          },
    });
  }, [items]);

  // ─── Keyboard: scroll the focused section into view; on Android lift the dock by its real overlap ───
  // Android's default softwareKeyboardLayoutMode is "resize" (the window already shrinks above the keyboard), so a
  // blind translateY(keyboardHeight) would double-lift. The lift is therefore the measured overlap between the
  // dock's bottom and the keyboard's top: 0 in resize mode, the full height in pan mode.
  useEffect(() => {
    const scrollFocusedSectionIntoView = () => {
      const key = focusedSectionRef.current;
      if (!key) return;
      scrollRef.current?.scrollTo({ y: Math.max(0, sectionY.current[key] - 8), animated: true });
    };
    const timing = { duration: dur(motion.duration.base), easing: ease.standard };
    const show = Keyboard.addListener("keyboardDidShow", (e: KeyboardEvent) => {
      if (Platform.OS !== "android") {
        requestAnimationFrame(scrollFocusedSectionIntoView);
        return;
      }
      const keyboardTop = e.endCoordinates.screenY;
      const wrap = dockWrapRef.current;
      if (!wrap) return;
      wrap.measureInWindow((_x, y, _w, h) => {
        const overlap = Math.max(0, Math.round(y + h - keyboardTop));
        dockLift.set(reduced ? -overlap : withTiming(-overlap, timing));
        setKbLift(overlap);
        requestAnimationFrame(scrollFocusedSectionIntoView);
      });
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      if (Platform.OS !== "android") return;
      dockLift.set(reduced ? 0 : withTiming(0, timing));
      setKbLift(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [dockLift, reduced]);

  useEffect(
    () => () => {
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    },
    [],
  );

  // ─── Handlers (stable, for the memoised sections) ───
  const handleClearCart = useCallback(() => {
    // One gesture → one haptic (CONTRACTS §8 'Clear cart confirmed → heavy'): the store's own `remove` is silenced
    // so the tap is not heavy + remove + ui_remove (W3 R2-03 / R4-01).
    feedback.heavy();
    suppressRemoveToastUntilRef.current = Date.now() + CLEAR_SUPPRESS_MS;
    const snap = cartActions.clearCart({ silent: true });
    const noUndo = getDevFlag("Dev_Cinder_inhibit_UndoRemove") || getDevFlag("Dev_Cinder_inhibit_Feature");
    notify({
      id: "cart-cleared",
      title: "Cart cleared",
      action: noUndo
        ? undefined
        : {
            label: "Undo",
            // The toast outlives placement: never re-insert into the empty post-order cart (W3 R2-18).
            onPress: () => {
              if (!navigatingAwayRef.current) cartActions.restoreCart(snap.items, snap.coupon);
            },
          },
    });
  }, []);
  // dismissTo pops to the live tabs route (merging {screen}) instead of stacking a second tab navigator on every
  // "Add more → View cart" loop (W3 R6-01 / R6-04 / R2-22).
  const handleAddMore = useCallback(() => {
    router.dismissTo("/(tabs)/home");
  }, []);
  const browseProducts = useCallback(() => {
    router.dismissTo("/(tabs)/home");
  }, []);

  const handleTipPreset = useCallback((next: TipPreset | null) => {
    setTipPreset(next);
    if (typeof next === "number") setThanksNonce((n) => n + 1);
    if (next !== "custom") setTipError(null);
  }, []);
  const handleCustomTipChange = useCallback((raw: string) => {
    setCustomTip(raw.replace(/\D/g, ""));
    setTipError(null);
  }, []);
  const handleCustomTipBlur = useCallback(() => {
    const parsed = parseInt(customTip, 10);
    if (!Number.isFinite(parsed)) return;
    if (parsed > TIP_CAP) {
      // Clamp + inline hint + ONE error (the Input shakes on the new error message).
      setCustomTip(String(TIP_CAP));
      setTipError(`Max ${formatMoney(TIP_CAP)}`);
      feedback.error();
      return;
    }
    if (parsed > 0) setThanksNonce((n) => n + 1);
  }, [customTip]);

  const markTouched = useCallback((field: FieldKey) => {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  }, []);
  const handleReceiverBlur = useCallback((field: ReceiverField) => markTouched(field), [markTouched]);
  const focusTip = useCallback(() => {
    focusedSectionRef.current = "tip";
  }, []);
  const focusGstin = useCallback(() => {
    focusedSectionRef.current = "gstin";
  }, []);
  const focusOrderFor = useCallback(() => {
    focusedSectionRef.current = "orderFor";
  }, []);
  const focusInstructions = useCallback(() => {
    focusedSectionRef.current = "instructions";
  }, []);
  const toggleGstin = useCallback(() => setGstinClaim((v) => !v), []);
  const handleGstinChange = useCallback((t: string) => setGstin(t.toUpperCase()), []);
  const handleGstinBlur = useCallback((field: "gstin" | "invoiceName") => markTouched(field), [markTouched]);
  const dismissDrift = useCallback(() => setDriftDismissed(true), []);

  const onSectionLayout = (key: SectionKey) => (e: LayoutChangeEvent) => {
    sectionY.current[key] = e.nativeEvent.layout.y;
  };

  // ─── Validation (cinder, M32): first problem in reading order ───
  const findProblem = (): Problem | null => {
    if (!location) {
      return {
        field: "address",
        summary: "Add a delivery address to continue",
        alertTitle: "No location",
        alertMessage: "Please select a delivery location.",
      };
    }
    if (orderFor === "others") {
      if (!receiverName.trim()) {
        return {
          field: "receiverName",
          summary: "Add the receiver's name to continue",
          alertTitle: "Missing details",
          alertMessage: "Please enter the receiver's name.",
        };
      }
      if (receiverPhone.trim().length !== PHONE_LENGTH) {
        return {
          field: "receiverPhone",
          summary: receiverPhone.trim() ? "Enter a valid 10-digit phone to continue" : "Add the receiver's phone to continue",
          alertTitle: "Invalid phone",
          alertMessage: "Please enter a valid 10-digit mobile number for the receiver.",
        };
      }
    }
    if (gstinClaim && gstin.trim()) {
      if (!isValidGstin(gstin)) {
        const hint = gstinHint(gstin) ?? "Check the GSTIN";
        return {
          field: "gstin",
          summary: hint,
          alertTitle: "Invalid GSTIN",
          alertMessage: `${hint}\n\nFix it, or remove it to continue without one.`,
        };
      }
      if (gstinCheck.state === "rejected") {
        return {
          field: "gstin",
          summary: gstinCheck.message,
          alertTitle: "GSTIN not accepted",
          alertMessage: `${gstinCheck.message}\n\nFix it, or remove it to continue without one.`,
        };
      }
      if (gstinCheck.state === "checking") {
        return {
          field: "gstin",
          summary: "Still checking your GSTIN — one moment",
          alertTitle: "Checking GSTIN",
          alertMessage: "Still checking your GSTIN with the GST portal — one moment.",
        };
      }
      // Required with a GSTIN — the website already enforced this, the app
      // didn't, so an app order could produce a GST invoice with a GSTIN and no
      // registered business name. (GST finding G5, 2026-10-02.)
      if (!invoiceName.trim()) {
        return {
          field: "invoiceName",
          summary: "Add your registered business name to continue",
          alertTitle: "Business name needed",
          alertMessage: "Enter your registered business name to go with the GSTIN, or remove the GSTIN to continue without one.",
        };
      }
    }
    return null;
  };

  const liveProblem = findProblem();
  const summary = submitted && liveProblem ? liveProblem.summary : null;

  // Inline errors appear after a blur ("touched") or a Pay attempt; GSTIN format problems are live like today, but
  // an INCOMPLETE GSTIN reads as a helper until the field is blurred, so the first keystroke is not red.
  const showReceiver = orderFor === "others";
  const receiverNameError =
    showReceiver && (submitted || touched.receiverName) && !receiverName.trim() ? "Enter the receiver's name" : null;
  const receiverPhoneError =
    showReceiver && (submitted || touched.receiverPhone) && receiverPhone.length !== PHONE_LENGTH
      ? "Enter a valid 10-digit mobile number"
      : null;
  const gstinTrimmed = gstin.trim();
  const gstinProb = gstinTrimmed ? gstinProblem(gstin) : null;
  const gstinHintText = gstinTrimmed ? gstinHint(gstin) : null;
  const gstinIncompleteSoft = gstinProb === "incomplete" && !(submitted || touched.gstin);
  const gstinError = !gstinTrimmed
    ? null
    : gstinProb && !gstinIncompleteSoft
      ? gstinHintText
      : gstinCheck.state === "rejected"
        ? gstinCheck.message
        : null;
  const gstinHelper = gstinError
    ? null
    : gstinIncompleteSoft
      ? gstinHintText
      : gstinCheck.state === "checking"
        ? "Checking with the GST portal…"
        : gstinCheck.state === "unavailable"
          ? "Couldn't check with the GST portal right now — we'll check again when you place the order."
          : !gstinTrimmed
            ? `${GSTIN_LENGTH} characters, e.g. ${GSTIN_EXAMPLE}`
            : null;
  const gstinVerified = gstinCheck.state === "verified";
  const invoiceNameLocked = gstinCheck.state === "verified" && !!gstinCheck.legalName;
  const invoiceNameError =
    gstinClaim && gstinTrimmed && (submitted || touched.invoiceName) && !invoiceName.trim()
      ? "Add your registered business name"
      : null;
  const addressError = submitted && !location;

  const dockHelper: PayDockHelper | null = summary
    ? { text: summary, tone: "danger" }
    : walletHint
      ? { text: walletHint, tone: "danger" }
      : offlineBlocked
        ? { text: OFFLINE_HELPER, tone: "warning" }
        : null;

  /** Pay tapped with a problem: scroll + shake + focus + ONE error haptic (or the legacy Alert under the flags). */
  const reportProblem = (problem: Problem) => {
    feedback.error();
    const legacy = getDevFlag("Dev_Cinder_inhibit_InlineValidation") || getDevFlag("Dev_Cinder_inhibit_Feature");
    if (legacy) {
      Alert.alert(problem.alertTitle, problem.alertMessage);
      return;
    }
    setSubmitted(true);
    setShakes((prev) => ({ ...prev, [problem.field]: prev[problem.field] + 1 }));
    const section = SECTION_FOR_FIELD[problem.field];
    if (!section) return; // the address strip lives in the dock — already on screen, shaken above
    scrollRef.current?.scrollTo({ y: Math.max(0, sectionY.current[section] - 12), animated: true });
    const target =
      problem.field === "receiverName"
        ? receiverNameRef
        : problem.field === "receiverPhone"
          ? receiverPhoneRef
          : problem.field === "gstin"
            ? gstinRef
            : invoiceNameRef;
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => target.current?.focus(), FOCUS_AFTER_SCROLL_MS);
  };

  // ─── Order creation (unchanged shape) ───

  /**
   * Creates the internal `customer_orders` row via the backend.
   *
   * Two callers:
   *   - COD path: uses the optimistic flag so the confirmation navigation fires
   *     as soon as the row exists.
   *   - Online / wallet path: cannot be optimistic (we must show the Razorpay
   *     sheet / debit the wallet first and only celebrate after verification),
   *     so it passes `optimistic = false` and awaits the real Order back.
   */
  const doCreateOrder = async (
    paymentStatus: "pending" | "paid",
    options: { optimistic?: boolean } = {},
  ): Promise<Order | undefined> => {
    if (!user?.id || !location) return undefined;
    const notesParts: string[] = [];
    if (deliveryInstructions.trim()) {
      notesParts.push(`Delivery Instructions: ${deliveryInstructions.trim()}`);
    }

    const sel = getPaymentSelection();
    const orderPayload = {
      user_id: user.id,
      customer_name: user.name || "Customer",
      customer_phone: user.phone || customer?.phone || "",
      customer_email: user.email || undefined,
      // The rail only. The backend's placeCheckoutOrder folds this string into the enum customer_orders.payment_method
      // (razorpay | cod | wallet) by substring — "wallet" → wallet, "upi" / "online" / "split" → razorpay, ANYTHING
      // ELSE → cod — so the Razorpay sub-method (card / netbanking / upi) must never be sent here: a card order posted
      // as "card" would be stored as cash on delivery (W3 R2-02). `preferredMethod` further down carries the
      // sub-method to the Razorpay sheet instead, and order labels come from paymentMethodLabel().
      payment_method: sel.mode,
      payment_status: paymentStatus,
      subtotal,
      delivery_fee: deliveryFee,
      order_total: finalPayable,
      delivery_address: location.address ?? location.label ?? "",
      delivery_latitude: location.latitude,
      delivery_longitude: location.longitude,
      items: items.map((i) => ({
        product_id: i.product_id,
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        image: i.image_url,
        unit: i.unit,
      })),
      notes: notesParts.length ? notesParts.join(" | ") : undefined,
      gstin: gstinClaim && gstin.trim() ? normalizeGstin(gstin) : undefined,
      gstin_business_name: gstinClaim && invoiceName.trim() ? invoiceName.trim() : undefined,
      receiver_name: orderFor === "others" && receiverName.trim() ? receiverName.trim() : undefined,
      receiver_phone: orderFor === "others" && receiverPhone.trim() ? `+91${receiverPhone.trim()}` : undefined,
      receiver_address: orderFor === "others" && receiverAddress.trim() ? receiverAddress.trim() : undefined,
      // C36: whole rupees only — order_total is rounded, so the tip must be too.
      tip_amount: tipAmount > 0 ? Math.round(tipAmount) : undefined,
      // Withheld once the coupon's own min_order_value is no longer met
      // (e.g. an item was removed after applying it) — discount is already
      // 0 in that state, and sending a no-longer-eligible coupon_id would
      // just make the backend re-derive the same "doesn't qualify" outcome.
      coupon_id: isCouponEligible ? appliedCoupon?.id : undefined,
    };

    if (options.optimistic) {
      // COD path — navigate to confirmation as soon as the order row exists.
      try {
        const created = await createOrder(orderPayload);
        // Flip the "has placed an order" flag so the Preferred Payment card
        // on the payment-options screen unlocks on the NEXT checkout flow.
        // Fire-and-forget; failing to persist this is non-fatal.
        markOrderPlaced().catch((err) => logSilentFailure("Mark order-placed flag", err));
        invalidateOrders(user.id);
        // Cart must be cleared now that the order is placed — the confirmation's
        // "add more" window does not attach items to this order, so leaving the
        // just-ordered items in the cart looked like checkout silently failed.
        // Silent: the confirmation screen owns the one success feedback.
        navigatingAwayRef.current = true;
        setNavigatingAway(true);
        cartActions.clearCart({ silent: true });
        goToOrderConfirmation(created.id);
        return created;
      } catch (err: unknown) {
        logError("Place order", err);
        showOrderFailure(err instanceof Error ? err.message : "Something went wrong placing your order.");
        return undefined;
      }
    }

    // Online / wallet path — caller awaits the real Order so it can pass `id` on.
    return createOrder(orderPayload);
  };

  // The order row is created before payment is attempted (Razorpay needs an
  // existing internal orderId to create its own payment order against — see
  // usePaymentFlow.ts), and creating it already fires the shopkeeper
  // notification/store-allocation broadcast (placeCheckoutOrder,
  // backend/src/services/database.service.ts). So a payment that's
  // genuinely cancelled or fails outright (as opposed to an *ambiguous*
  // verify-failure that a webhook might still settle) must actively void the
  // order via the same cancel endpoint used from Orders, not leave it
  // "placed" for a shopkeeper to start prepping something nobody paid for.
  const voidUnpaidOrder = async (orderId: string) => {
    try {
      await cancelOrder(orderId);
      // The list entry still holds the pre-void status; drop it so Orders / Home refetch (W3 R2-11).
      if (user?.id) invalidateOrders(user.id);
    } catch (err) {
      // Best-effort — if this fails (e.g. a delivery partner was assigned in
      // the vanishingly unlikely window between order creation and the
      // payment being cancelled), the order is still real; the toast already
      // tells the customer to check Orders regardless.
      logSilentFailure("Void unpaid order after payment cancellation", err);
    }
  };

  const placeOrder = async () => {
    if (placingRef.current) return;
    if (offlineBlocked || items.length === 0) return;
    const problem = findProblem();
    if (problem) {
      reportProblem(problem);
      return;
    }
    if (!location) return; // narrowed by findProblem; keeps TS honest below
    // Pay without blurring the custom tip: clamp the FIELD too (the totals already use the capped value) so it never
    // reads '9999' while ₹500 is charged (W3 R2-19). Silent — the Pay gesture owns the feedback.
    if (tipPreset === "custom") {
      const parsed = parseInt(customTip, 10);
      if (Number.isFinite(parsed) && parsed > TIP_CAP) {
        setCustomTip(String(TIP_CAP));
        setTipError(`Max ${formatMoney(TIP_CAP)}`);
      }
    }
    if (!user?.id) {
      feedback.error();
      notify({ id: "session-expired", title: "Session expired", message: "Please log in again.", tone: "error" });
      return;
    }
    setWalletHint(null);
    placingRef.current = true;
    setPlacing(true);
    try {
      const currentSelection = getPaymentSelection();
      if (currentSelection.mode === "cod") {
        await doCreateOrder("pending", { optimistic: true });
        return;
      }

      // ─── Wallet payment ────────────────────────────────────────────────────
      // Same two-step shape as the online path below (create order pending,
      // then pay it off) but no Razorpay sheet — payOrderWithWallet debits
      // the balance synchronously. On success it's identical to a completed
      // online payment from here on (confirmation screen, cache-busting);
      // on failure (most likely insufficient balance) the order is voided and
      // the customer retries from checkout, cart intact.
      if (currentSelection.mode === "wallet") {
        // Re-check the balance right before creating the order, not just at
        // selection time on the payment-options screen — a customer who
        // picked Wallet there and then changed their cart (pushing the total
        // past their balance) could otherwise still submit with a doomed
        // selection. The cached balance paints the check instantly; the
        // network read is the truth when it answers.
        let balance = peekWalletBalance();
        try {
          balance = await getWalletBalance({ force: true });
        } catch (err) {
          // Balance check itself failed (network blip) — fall through and
          // let the actual payOrderWithWallet call be the source of truth.
          logSilentFailure("Wallet balance before checkout", err);
        }
        if (balance !== undefined && balance < finalPayable) {
          const hint = `Insufficient wallet balance (${formatMoney(balance)}) — add money or pick another method`;
          setWalletHint(hint);
          feedback.error();
          notify({
            id: "wallet-insufficient",
            title: "Insufficient wallet balance",
            message: "Add money or choose another payment method.",
            tone: "error",
          });
          return;
        }

        const internalOrder = await doCreateOrder("pending");
        if (!internalOrder?.id) {
          throw new Error("Could not create order");
        }
        setPayingOrderId(internalOrder.id);
        try {
          await payOrderWithWallet(internalOrder.id);
          markOrderPlaced().catch((err) => logSilentFailure("Mark order-placed flag", err));
          invalidateOrders(user.id);
          navigatingAwayRef.current = true;
          setNavigatingAway(true);
          cartActions.clearCart({ silent: true });
          goToOrderConfirmation(internalOrder.id);
        } catch (err: unknown) {
          // Wallet debit is atomic (either fully succeeds or fully fails, no
          // ambiguous in-flight state like a Razorpay webhook) — safe to void
          // outright and let the customer retry from checkout, cart intact.
          await voidUnpaidOrder(internalOrder.id);
          const message = err instanceof Error ? err.message : "Payment could not be completed.";
          feedback.error();
          notify({
            id: "wallet-failed",
            title: "Wallet payment failed — your cart is safe",
            message: `${message} Your order was not placed.`,
            tone: "error",
          });
        }
        return;
      }

      // ─── Online payment (Razorpay) ────────────────────────────────────────
      // Mirrors near-and-now/frontend/src/pages/CheckoutPage.tsx exactly:
      //   1. Create the internal customer_orders row with payment_status='pending'.
      //   2. Hand off to usePaymentFlow.payForOrder, which:
      //      a. POSTs /api/payment/create  (backend uses DB amount as truth)
      //      b. Opens the Razorpay sheet
      //      c. POSTs /api/payment/verify with the signature
      //      d. If verify hiccups, polls the DB for ~10s in case the webhook lands first
      // The processing overlay is driven by `paymentPhase`, so the user always
      // sees clear "Setting up… / Verifying… / Confirming with bank…" states
      // instead of a frozen-looking checkout screen.
      const internalOrder = await doCreateOrder("pending");
      if (!internalOrder?.id) {
        throw new Error("Could not create order");
      }
      setPayingOrderId(internalOrder.id);

      const result = await payForOrder({
        internalOrderId: internalOrder.id,
        userId: user.id,
        amount: finalPayable,
        customer: {
          name: user.name || "Customer",
          email: user.email || undefined,
          phone: user.phone || customer?.phone || undefined,
        },
        // Honour the rail the user chose on the payment-options screen so
        // the Razorpay sheet lands on that tab (UPI / Card / Wallet /
        // Netbanking). EMI isn't used by our checkout, so filter it out.
        preferredMethod:
          currentSelection.method && currentSelection.method !== "emi" ? currentSelection.method : undefined,
      });

      if (result.status === "paid") {
        // Flip the "has placed an order" flag so the Preferred Payment card
        // on the payment-options screen unlocks on the NEXT checkout flow.
        markOrderPlaced().catch((err) => logSilentFailure("Mark order-placed flag", err));
        // Bust the saved-methods cache so the token Razorpay just minted
        // for this payment shows up on the very next visit to the
        // payment-options screen (instead of the stale empty cache).
        clearSavedPaymentMethodsCache();
        invalidateOrders(user.id);
        navigatingAwayRef.current = true;
        setNavigatingAway(true);
        cartActions.clearCart({ silent: true });
        goToOrderConfirmation(internalOrder.id);
        return;
      }

      // `error` (payment setup itself failed — the Razorpay sheet never even
      // opened) is a clean "no charge happened" outcome — void the order and
      // let the customer retry right here on checkout instead of being sent
      // to Orders for an order that no longer really exists.
      if (result.status === "error") {
        await voidUnpaidOrder(internalOrder.id);
        feedback.error();
        notify({
          id: "payment-unavailable",
          title: "Payment unavailable — your cart is safe",
          message: `${result.message} Your order was not placed.`,
          tone: "error",
        });
        return;
      }

      // `pending`/cancelled|failed (the sheet opened but the customer backed
      // out, or the bank/card declined outright) is equally clean — same
      // void-and-retry treatment.
      if (result.reason === "cancelled" || result.reason === "failed") {
        await voidUnpaidOrder(internalOrder.id);
        const cancelled = result.reason === "cancelled";
        feedback.error();
        notify({
          id: "payment-cancelled",
          title: cancelled ? "Payment cancelled — your cart is safe" : "Payment failed — your cart is safe",
          message: result.message ?? (cancelled ? "You cancelled the payment." : "Payment could not be completed."),
          tone: "error",
        });
        return;
      }

      // status === 'pending', reason 'verify_failed' or 'unverified' — this
      // is genuinely ambiguous (Razorpay's webhook may still land and
      // confirm the charge after we gave up polling), so unlike a clean
      // cancel/fail above, voiding the order here risks cancelling one that
      // then gets marked paid. Kept exactly as before: order stays, cart is
      // cleared, customer is routed to Orders to follow up. This Alert stays
      // (it explains money and navigates).
      invalidateOrders(user.id);
      navigatingAwayRef.current = true;
      setNavigatingAway(true);
      cartActions.clearCart({ silent: true });

      const messageByReason = {
        verify_failed:
          (result.message ?? "Payment could not be verified.") +
          "\n\nIf money was debited it will reflect shortly, or auto-refund within 5–7 days.",
        unverified: result.message ?? "We could not confirm your payment yet. Please check Orders in a minute.",
      } as const;

      feedback.error();
      Alert.alert(
        "Payment not confirmed",
        messageByReason[result.reason],
        [{ text: "Go to Orders", onPress: () => router.replace("/orders") }],
        {
          cancelable: true,
          onDismiss: () => {
            // Android back on the Alert: the cart is empty now, so show the empty state instead of a frozen frame.
            navigatingAwayRef.current = false;
            setNavigatingAway(false);
          },
        },
      );
      return;
    } catch (err: unknown) {
      logError("Place order", err);
      showOrderFailure(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      placingRef.current = false;
      setPlacing(false);
      setPayingOrderId(null);
    }
  };

  // ─── Render ───
  const addressBlock = useMemo(
    () => (
      <AddressBlock
        label={location?.label ?? null}
        address={location?.address ?? null}
        shakeTrigger={shakes.address}
        error={addressError}
      />
    ),
    [location?.label, location?.address, shakes.address, addressError],
  );

  const showSkeleton = useForceSkeleton(!isHydrated || navigatingAway);
  const showEmpty = !showSkeleton && items.length === 0;

  return (
    <Screen bg={C.card} edges={["top"]}>
      <ScreenHeader size="md" align="left" title="Cart" subtitle={subtitle} backFallbackHref="/(tabs)/home" />

      {showSkeleton ? (
        <CheckoutSkeleton />
      ) : showEmpty ? (
        <EmptyState
          fill
          iconWrap
          icon="cart-outline"
          title="Your cart is empty"
          text="Add fresh picks from nearby stores"
          action={{ label: "Browse products", onPress: browseProducts }}
        />
      ) : (
        <>
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={Platform.OS === "ios" ? dockHeight : 0}
          >
            <ScrollView
              ref={scrollRef}
              style={styles.flex}
              contentContainerStyle={{ paddingBottom: dockHeight + 16 + kbLift }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <ItemsSection items={items} onClearCart={handleClearCart} onAddMore={handleAddMore} />
              {drift.length > 0 && !driftDismissed ? <PriceDriftRow drifts={drift} onDismiss={dismissDrift} /> : null}

              {/* Owns its own band + header; renders null when empty / offline / Dev_Checkout_inhibit_RecoNetwork. */}
              <DidYouForgetStrip cartSig={cartSig} locKey={locationKey} />

              <View style={styles.band} />
              <OffersRow subtotal={subtotal} appliedCoupon={appliedCoupon} isCouponEligible={isCouponEligible} discount={discount} />

              <View style={styles.band} />
              <BillSection
                subtotal={subtotal}
                discount={discount}
                platformFee={platformFee}
                handlingFee={handlingFee}
                deliveryFee={deliveryFee}
                deliveryFeeWas={DELIVERY_FEE_WAS}
                tipAmount={tipAmount}
                finalPayable={finalPayable}
              />

              <View style={styles.band} />
              <View onLayout={onSectionLayout("tip")}>
                <TipSection
                  preset={tipPreset}
                  customTip={customTip}
                  customError={tipError}
                  thanksNonce={thanksNonce}
                  onPresetChange={handleTipPreset}
                  onCustomChange={handleCustomTipChange}
                  onCustomBlur={handleCustomTipBlur}
                  onCustomFocus={focusTip}
                  inputRef={tipRef}
                />
              </View>

              <View style={styles.band} />
              <View onLayout={onSectionLayout("gstin")}>
                <GstinSection
                  open={gstinClaim}
                  onToggle={toggleGstin}
                  gstin={gstin}
                  onGstinChange={handleGstinChange}
                  gstinError={gstinError}
                  gstinHelper={gstinHelper}
                  verified={gstinVerified}
                  invoiceName={invoiceName}
                  onInvoiceNameChange={setInvoiceName}
                  invoiceNameLocked={invoiceNameLocked}
                  invoiceNameError={invoiceNameError}
                  gstinShake={shakes.gstin}
                  invoiceNameShake={shakes.invoiceName}
                  gstinRef={gstinRef}
                  invoiceNameRef={invoiceNameRef}
                  onFieldFocus={focusGstin}
                  onFieldBlur={handleGstinBlur}
                />
              </View>

              <View style={styles.band} />
              <View onLayout={onSectionLayout("orderFor")}>
                <OrderForSection
                  value={orderFor}
                  onChange={setOrderFor}
                  receiverName={receiverName}
                  receiverPhone={receiverPhone}
                  receiverAddress={receiverAddress}
                  onReceiverNameChange={setReceiverName}
                  onReceiverPhoneChange={setReceiverPhone}
                  onReceiverAddressChange={setReceiverAddress}
                  nameError={receiverNameError}
                  phoneError={receiverPhoneError}
                  nameShake={shakes.receiverName}
                  phoneShake={shakes.receiverPhone}
                  onFieldBlur={handleReceiverBlur}
                  onFieldFocus={focusOrderFor}
                  nameRef={receiverNameRef}
                  phoneRef={receiverPhoneRef}
                />
              </View>

              <View style={styles.band} />
              <View onLayout={onSectionLayout("instructions")}>
                <InstructionsSection value={deliveryInstructions} onChange={setDeliveryInstructions} onFocus={focusInstructions} />
              </View>

              <View style={styles.band} />
              <PolicyNote />
            </ScrollView>
          </KeyboardAvoidingView>

          {/* The dock stack: measured by `dockWrapRef` for the keyboard overlap, lifted by the Animated.View. */}
          <View ref={dockWrapRef} style={styles.dockWrap} pointerEvents="box-none">
            <Animated.View style={dockLiftStyle}>
              <PayDock
                finalPayable={finalPayable}
                tipAmount={tipAmount}
                placing={placing}
                disabled={offlineBlocked}
                disabledHint={offlineBlocked ? OFFLINE_HELPER : null}
                helper={dockHelper}
                top={addressBlock}
                onPay={placeOrder}
              />
            </Animated.View>
          </View>
        </>
      )}

      {RazorpayUI}
      <PaymentProcessingOverlay phase={paymentPhase} orderId={payingOrderId} />
    </Screen>
  );
}

// ─── Module-local sections ────────────────────────────────────────────────────

function PriceDriftRow({ drifts, onDismiss }: { drifts: PriceDrift[]; onDismiss: () => void }): React.JSX.Element {
  const n = drifts.length;
  return (
    <View style={styles.driftWrap}>
      <View style={styles.drift} accessibilityLiveRegion="polite">
        <View style={styles.driftHeader}>
          <MaterialCommunityIcons name="tag-outline" size={16} color={C.warningText} />
          <Text style={styles.driftTitle} maxFontSizeMultiplier={1.3}>
            {`Prices updated for ${n} ${n === 1 ? "item" : "items"}`}
          </Text>
          <IconButton
            icon="close"
            size={28}
            iconSize={16}
            bg="transparent"
            color={C.warningText}
            accessibilityLabel="Dismiss price update notice"
            onPress={onDismiss}
          />
        </View>
        {drifts.map((d) => (
          <Text key={d.product_id} style={styles.driftLine} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {`${d.name}: ${formatMoney(d.oldPrice)} → ${formatMoney(d.newPrice)}`}
          </Text>
        ))}
      </View>
    </View>
  );
}

type GstinSectionProps = {
  open: boolean;
  onToggle: () => void;
  gstin: string;
  onGstinChange: (t: string) => void;
  gstinError: string | null;
  gstinHelper: string | null;
  verified: boolean;
  invoiceName: string;
  onInvoiceNameChange: (t: string) => void;
  invoiceNameLocked: boolean;
  invoiceNameError: string | null;
  gstinShake: number;
  invoiceNameShake: number;
  gstinRef: React.Ref<TextInput>;
  invoiceNameRef: React.Ref<TextInput>;
  onFieldFocus: () => void;
  onFieldBlur: (field: "gstin" | "invoiceName") => void;
};

/** "Add GSTIN" row (ListRow + Collapsible; the GST chip is brand green, no blue) with the two fields on Inputs. */
const GstinSection = React.memo(function GstinSection({
  open,
  onToggle,
  gstin,
  onGstinChange,
  gstinError,
  gstinHelper,
  verified,
  invoiceName,
  onInvoiceNameChange,
  invoiceNameLocked,
  invoiceNameError,
  gstinShake,
  invoiceNameShake,
  gstinRef,
  invoiceNameRef,
  onFieldFocus,
  onFieldBlur,
}: GstinSectionProps): React.JSX.Element {
  const added = open && isValidGstin(gstin);
  const title = added ? "GSTIN added" : "Add GSTIN";
  return (
    <View style={styles.section}>
      <ListRow
        title={title}
        subtitle="Get a GST invoice for input tax credit"
        left={
          <IconWrap size={34} bg={C.primaryXLight}>
            <Text style={styles.gstChip} maxFontSizeMultiplier={1.3}>
              GST
            </Text>
          </IconWrap>
        }
        right={<ChevronRotate open={open} />}
        onPress={onToggle}
        style={styles.gstRow}
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
      />
      <Collapsible open={open}>
        <View style={styles.gstFields}>
          <Input
            label="GSTIN"
            variant="underline"
            value={gstin}
            onChangeText={onGstinChange}
            onFocus={onFieldFocus}
            onBlur={() => onFieldBlur("gstin")}
            error={gstinError}
            helper={gstinHelper ?? undefined}
            shakeTrigger={gstinShake}
            inputRef={gstinRef}
            placeholder={`Enter your ${GSTIN_LENGTH}-character GSTIN`}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={GSTIN_LENGTH}
            returnKeyType="next"
          />
          {verified ? (
            <View style={styles.verifiedRow} accessibilityLiveRegion="polite">
              <MaterialCommunityIcons name="check-circle" size={14} color={C.successText} />
              <Text style={styles.verifiedText} maxFontSizeMultiplier={1.3}>
                Verified on the GST portal · Active
              </Text>
            </View>
          ) : null}
          <Input
            label="Registered business name"
            variant="underline"
            value={invoiceName}
            onChangeText={onInvoiceNameChange}
            onFocus={onFieldFocus}
            onBlur={() => onFieldBlur("invoiceName")}
            editable={!invoiceNameLocked}
            error={invoiceNameError}
            helper={invoiceNameLocked ? "Filled from the GST registry" : "Required with a GSTIN"}
            shakeTrigger={invoiceNameShake}
            inputRef={invoiceNameRef}
            placeholder="As registered on the GST portal"
            autoCapitalize="words"
            returnKeyType="done"
          />
        </View>
      </Collapsible>
    </View>
  );
});

const InstructionsSection = React.memo(function InstructionsSection({
  value,
  onChange,
  onFocus,
}: {
  value: string;
  onChange: (t: string) => void;
  onFocus: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Input
        label="Delivery instructions"
        variant="underline"
        value={value}
        onChangeText={onChange}
        onFocus={onFocus}
        placeholder="e.g. call on arrival, gate code, leave at the door"
        multiline
        maxLength={200}
        showCounter
        textAlignVertical="top"
        returnKeyType="default"
      />
    </View>
  );
});

function PolicyNote(): React.JSX.Element {
  return (
    <View style={styles.policy}>
      <Text style={styles.policyText} maxFontSizeMultiplier={1.3}>
        {POLICY_COPY}
      </Text>
      <PressableScale
        scale={motion.scale.chip}
        onPress={() => router.push("/settings/support")}
        hitSlop={LINK_HIT_SLOP}
        innerStyle={styles.policyLink}
        accessibilityRole="link"
        accessibilityLabel="Cancellation policy"
      >
        <Text style={styles.policyLinkText} maxFontSizeMultiplier={1.3}>
          Cancellation policy
        </Text>
      </PressableScale>
    </View>
  );
}

/** Cold-deep-link frame while the cart hydrates: three item-row twins + a bill block, one shared skeleton clock. */
function CheckoutSkeleton(): React.JSX.Element {
  return (
    <SkeletonScreen style={styles.flex}>
      <View style={styles.section}>
        {SKELETON_ROWS.map((k) => (
          <View key={k} style={styles.skelRow}>
            <Skeleton width={56} height={56} radius={radius.lg} />
            <View style={styles.skelText}>
              <Skeleton width="70%" height={14} />
              <Skeleton width="40%" height={12} />
            </View>
            <Skeleton width={84} height={32} radius={radius.md} />
          </View>
        ))}
      </View>
      <View style={styles.band} />
      <View style={styles.section}>
        <Skeleton width={120} height={17} />
        {SKELETON_BILL_ROWS.map((k) => (
          <View key={k} style={styles.skelBillRow}>
            <Skeleton width="45%" height={12} />
            <Skeleton width={56} height={12} />
          </View>
        ))}
        <View style={styles.skelBillRow}>
          <Skeleton width={64} height={16} />
          <Skeleton width={80} height={22} />
        </View>
      </View>
    </SkeletonScreen>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // The owner's 8 px separator between flat sections (wallet pattern, retinted to the token).
  band: { height: 8, backgroundColor: C.surfaceBand },
  section: { backgroundColor: C.card, paddingHorizontal: 16, paddingVertical: 14 },
  dockWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },

  // Price drift (kepler)
  driftWrap: { backgroundColor: C.card, paddingHorizontal: 16, paddingBottom: 12 },
  drift: {
    backgroundColor: C.warningLight,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: C.warningBorder,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 10,
  },
  driftHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  driftTitle: { flex: 1, fontFamily: fontFamily.semibold, fontSize: 13, color: C.warningText },
  driftLine: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16, color: C.warningText, marginTop: 2 },

  // GSTIN
  gstRow: { paddingHorizontal: 0, paddingVertical: 2 },
  // 11 px, not the spec's 10: DECISIONS D10 floors every text at 11 px.
  gstChip: { fontFamily: fontFamily.bold, fontSize: 11, letterSpacing: 0.3, color: C.primary },
  gstFields: { gap: 12, paddingTop: 12 },
  verifiedRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  verifiedText: { fontFamily: fontFamily.semibold, fontSize: 11, color: C.successText },

  // Policy note (C35)
  policy: {
    backgroundColor: C.warningLight,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.warningBorder,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  policyText: { fontFamily: fontFamily.regular, fontSize: 12, lineHeight: 17, color: C.textSub },
  policyLink: { alignSelf: "flex-start", minHeight: 32, justifyContent: "center", paddingVertical: 4 },
  policyLinkText: { fontFamily: fontFamily.bold, fontSize: 12, color: C.primaryDark },

  // Skeleton
  skelRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  skelText: { flex: 1, gap: 8 },
  skelBillRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 },
});
