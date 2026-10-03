// codename: nova
// AddMoreWindow — the 30 s "Forgot something?" window after an order is placed (design/blinkit-parity §3.10 ·
// speed #11 · motion M10). It owns the 1 s tick (nothing else on the screen re-renders per second — MAP P9), a
// UI-thread `scaleX` ProgressBar that turns `C.warning` under 10 s, and the EXPLICIT "Pay ₹X to add N items" button:
// nothing ever charges without this press (MAP C14 / §7.16, PLAN §5 rule 9). No countdown haptics (motion doc C8).
// After expiry it collapses to the quiet "Add-more window closed" row.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { fontFamily, iconSize, radius, text } from "../../constants/ui";
import { formatMoney } from "../../lib/formatMoney";
import { PrimaryButton, ProgressBar } from "../ui";

/** 'unverified' = the gateway charged but verify failed: NO Pay button, debit/refund copy — never "pay again" (W3 R2-01). */
export type AddItemsPhase = "idle" | "processing" | "done" | "failed" | "unverified";

export type AddMoreWindowProps = {
  /** `order.created_at` in ms — the countdown is anchored here, never to mount time (see `remainingAddMoreSeconds`). */
  placedAtMs: number;
  /** Window length in seconds. Default `ADD_MORE_WINDOW_SECONDS` (30). */
  windowSeconds?: number;
  /** Distinct cart lines added since the order was placed. */
  itemCount: number;
  /** Cart subtotal — the delta the gateway will charge (the backend re-derives the exact amount). */
  amount: number;
  /** COD orders read "Add N items to this order"; the caption still says the extras are paid online now. */
  isCod: boolean;
  /** Add-items flow state owned by the screen. `processing` shows the button loading; `done` shows the added row. */
  phase: AddItemsPhase;
  /** Inline failure copy under the button (the screen already toasted it). */
  errorMessage?: string | null;
  /** The ONLY trigger of the addition payment flow. */
  onPay: () => void;
  /** Ghost "Keep shopping" → Home (silent navigation). */
  onKeepShopping: () => void;
  /** After expiry with items still in the cart: "Go to cart" → checkout (DECISIONS D5). */
  onGoToCart: () => void;
  /** Called once when the countdown reaches 0 (also immediately when the window was already closed at mount). */
  onExpired?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

// Matches ADD_ITEMS_WINDOW_MS's 35s server-side backstop in
// backend/src/controllers/orderAdditions.controller.ts (a few seconds'
// grace beyond this client countdown, for request latency) — this is the
// number the customer actually sees and the one that should feel authoritative.
export const ADD_MORE_WINDOW_SECONDS = 30;

/** Under this many seconds the bar and the digits turn to the warning colour (M10). */
const URGENT_SECONDS = 10;
/** Progress bar height — thinner than the default 6 so it reads as a timer, not a loader. */
const BAR_HEIGHT = 4;

/**
 * Seconds left in the add-more window, anchored to the order's placed time rather than "time since this screen
 * happened to mount". A pure mount-relative timer would show a fresh, misleading "30s left!" if this screen ever
 * remounts long after the order was actually placed (app killed and reopened, a stale deep link, Fast Refresh in
 * dev) — the backend's own window (ADD_ITEMS_WINDOW_MS in orderAdditions.controller.ts) is anchored to placed_at,
 * so a customer could go through the trouble of adding items only to have the server reject them as late, with the
 * screen never having shown anything was wrong. A non-finite `placedAtMs` counts as closed (never offer a charge
 * the backend will reject).
 */
export function remainingAddMoreSeconds(placedAtMs: number, windowSeconds: number = ADD_MORE_WINDOW_SECONDS): number {
  if (!Number.isFinite(placedAtMs)) return 0;
  const elapsedSec = Math.floor((Date.now() - placedAtMs) / 1000);
  return Math.max(0, windowSeconds - elapsedSec);
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Countdown + progress + explicit pay button while the window is open; the quiet closed row afterwards. Only this
 * component re-renders on the 1 s tick. The tick recomputes from `Date.now()` on every beat so a background stall
 * cannot leave the display behind the backend's clock.
 */
/** Copy for a charge the gateway reported but the backend could not confirm in time. */
export const UNVERIFIED_COPY =
  "Payment received — we couldn't confirm the add-on yet. If money was debited it will reflect on your order or auto-refund in 5–7 days. Don't pay again.";

export function AddMoreWindow({
  placedAtMs,
  windowSeconds = ADD_MORE_WINDOW_SECONDS,
  itemCount,
  amount,
  isCod,
  phase,
  errorMessage,
  onPay,
  onKeepShopping,
  onGoToCart,
  onExpired,
  style,
  testID,
}: AddMoreWindowProps): React.JSX.Element {
  const [timeLeft, setTimeLeft] = useState(() => remainingAddMoreSeconds(placedAtMs, windowSeconds));
  const onExpiredRef = useRef(onExpired);

  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  useEffect(() => {
    const initial = remainingAddMoreSeconds(placedAtMs, windowSeconds);
    setTimeLeft(initial);
    if (initial <= 0) {
      onExpiredRef.current?.();
      return;
    }
    const interval = setInterval(() => {
      const next = remainingAddMoreSeconds(placedAtMs, windowSeconds);
      setTimeLeft(next);
      if (next <= 0) {
        clearInterval(interval);
        onExpiredRef.current?.();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [placedAtMs, windowSeconds]);

  const expired = timeLeft <= 0;
  const urgent = timeLeft <= URGENT_SECONDS;
  const rupees = formatMoney(amount, { decimals: 0 });
  const items = plural(itemCount, "item", "items");
  const payLabel = isCod ? `Add ${items} to this order` : `Pay ${rupees} to add ${items}`;
  // C14: the copy must say a payment starts — for COD orders too, since the extras are always a separate online charge.
  const caption = isCod ? `Extra items are paid online now · ${rupees}` : "Paid now, delivered with your order";
  // Announced at the start and once more at 10 s left — never every second (a11y spec).
  const countdownLabel = urgent
    ? `${URGENT_SECONDS} seconds left to add items`
    : `About ${windowSeconds} seconds to add items to this order`;

  if (expired) {
    return (
      <View style={[styles.wrap, styles.closedWrap, style]} testID={testID}>
        <View style={styles.closedRow} accessible accessibilityLiveRegion="polite" accessibilityLabel="Add-more window closed">
          <MaterialCommunityIcons name="clock-check-outline" size={iconSize.sm} color={C.textSub} />
          <Text style={styles.closedText} maxFontSizeMultiplier={1.3}>
            Add-more window closed
          </Text>
        </View>
        {itemCount > 0 && phase !== "done" ? (
          <PrimaryButton variant="ghost" size="xs" label="Go to cart" onPress={onGoToCart} testID={testID ? `${testID}-cart` : undefined} />
        ) : null}
      </View>
    );
  }

  const showDone = phase === "done" && itemCount === 0;

  return (
    <View style={[styles.wrap, style]} testID={testID}>
      <View style={styles.headRow}>
        <View style={styles.headText}>
          <Text style={styles.title} maxFontSizeMultiplier={1.3}>
            Forgot something?
          </Text>
          <Text style={styles.sub} maxFontSizeMultiplier={1.3}>
            Add items now and they&apos;ll arrive with this order
          </Text>
        </View>
        <View accessible accessibilityLiveRegion="polite" accessibilityLabel={countdownLabel}>
          <Text
            style={[styles.countdown, urgent && styles.countdownUrgent]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            maxFontSizeMultiplier={1.2}
            testID={testID ? `${testID}-countdown` : undefined}
          >
            {formatTime(timeLeft)}
          </Text>
        </View>
      </View>

      <ProgressBar
        progress={timeLeft / windowSeconds}
        color={urgent ? C.warning : C.primary}
        height={BAR_HEIGHT}
        accessibilityLabel="Time left to add items"
        style={styles.bar}
      />

      {showDone ? (
        <View style={styles.doneRow} accessible accessibilityLiveRegion="polite">
          <MaterialCommunityIcons name="check-circle-outline" size={iconSize.md} color={C.primary} />
          <Text style={styles.doneText} maxFontSizeMultiplier={1.3}>
            Items added — they&apos;ll arrive with this delivery
          </Text>
        </View>
      ) : phase === "unverified" ? (
        <View style={styles.doneRow} accessible accessibilityLiveRegion="assertive">
          <MaterialCommunityIcons name="clock-alert-outline" size={iconSize.md} color={C.warningText} />
          <Text style={styles.unverifiedText} maxFontSizeMultiplier={1.3}>
            {errorMessage ?? UNVERIFIED_COPY}
          </Text>
        </View>
      ) : itemCount > 0 ? (
        <>
          <PrimaryButton
            size="md"
            label={payLabel}
            onPress={onPay}
            loading={phase === "processing"}
            accessibilityLabel={isCod ? `${payLabel}, ${rupees} paid online now` : payLabel}
            style={styles.pay}
            testID={testID ? `${testID}-pay` : undefined}
          />
          <Text style={styles.caption} maxFontSizeMultiplier={1.3}>
            {caption}
          </Text>
          {phase === "failed" && errorMessage ? (
            <Text style={styles.errorText} accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3}>
              {errorMessage}
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.caption} maxFontSizeMultiplier={1.3}>
          Pick something below — it comes with this delivery
        </Text>
      )}

      <PrimaryButton
        variant="ghost"
        size="sm"
        label="Keep shopping"
        onPress={onKeepShopping}
        style={styles.ghost}
        testID={testID ? `${testID}-keep` : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  closedWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    backgroundColor: C.bgSoft,
    borderColor: C.bgSoft,
  },
  closedRow: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  closedText: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16, color: C.textSub },
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headText: { flex: 1 },
  title: { ...text.h3 },
  sub: { ...text.rowSubtitle, lineHeight: 16, marginTop: 4 },
  countdown: {
    fontFamily: fontFamily.extrabold,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.4,
    color: C.text,
    fontVariant: ["tabular-nums"],
  },
  countdownUrgent: { color: C.warningText },
  bar: { marginTop: 14 },
  pay: { marginTop: 16 },
  caption: { ...text.rowSubtitle, lineHeight: 16, marginTop: 8, textAlign: "center" },
  errorText: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16, color: C.danger, marginTop: 6, textAlign: "center" },
  doneRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 },
  doneText: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16, color: C.textSub, flex: 1 },
  unverifiedText: { ...text.bodySm, color: C.warningText, flex: 1 },
  ghost: { alignSelf: "center", marginTop: 6 },
});
