// PaymentProcessingOverlay — full-screen modal shown while an online payment is in flight
// (speed-and-ease #34, motion M22, MAP §4.3 U26). The halo is the one sanctioned idle loop
// (indeterminate progress) and runs on the `Pulse` primitive; everything else is reanimated
// enter/exit presets. No haptic or sound fires in here — the checkout code plays
// `success`/`error` on the result (CONTRACTS §8).
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Platform, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { C } from "../constants/colors";
import { fontFamily, radius, shadow, space, text } from "../constants/ui";
import type { PaymentPhase } from "../hooks/usePaymentFlow";
import { enter, exit, layoutTiming, PrimaryButton, Pulse, type IconName } from "./ui";

type VisiblePhase = Exclude<PaymentPhase, "idle" | "awaiting_gateway">;

interface PhaseContent {
  title: string;
  subtitle: string;
  icon: IconName;
}

const PHASE_CONTENT: Record<VisiblePhase, PhaseContent> = {
  preparing: {
    title: "Setting up payment…",
    subtitle: "Securely connecting to Razorpay. This takes just a second.",
    icon: "shield-lock-outline",
  },
  verifying: {
    title: "Verifying payment…",
    subtitle: "We're confirming your payment with the bank. Please don't close the app.",
    icon: "shield-check-outline",
  },
  reconciling: {
    title: "Confirming with bank…",
    subtitle: "Your payment is being settled. This can take a moment — we'll update your order automatically.",
    icon: "bank-outline",
  },
};

/**
 * After this long in `verifying` | `reconciling` the overlay escalates in place
 * (U26): the 30 s verify timeout + 10 s reconcile window used to be 40 s of
 * static copy. Counted continuously across the two phases, reset on hide.
 */
const ESCALATE_AFTER_MS = 15_000;
/** Pulse ring diameter; the icon disc below it stays at the old 84 px. */
const HALO_SIZE = 96;
const DISC_SIZE = 84;
const ICON_SIZE = 40;

function isVisiblePhase(phase: PaymentPhase): phase is VisiblePhase {
  return phase === "preparing" || phase === "verifying" || phase === "reconciling";
}

export interface PaymentProcessingOverlayProps {
  phase: PaymentPhase;
  /**
   * The order being paid, when the consumer knows it (checkout after
   * `createOrder`, orders / order detail retries). Carried to
   * `/settings/support?orderId=` by the "Need help?" link.
   */
  orderId?: string | null;
}

/**
 * Full-screen modal shown during the online-payment flow.
 *
 * Visible during `preparing`, `verifying`, and `reconciling`. Hidden during
 * `awaiting_gateway` (Razorpay's native sheet takes over the screen) and
 * `idle`. The modal is non-dismissable on Android back-press to prevent the
 * user from breaking the flow mid-verify. After 15 s of verifying/reconciling
 * it shows "Taking longer than usual" + a "Need help?" link; pressing that
 * hides the overlay first (a route pushed under an open RN Modal is invisible
 * — MAP §7.5) and pushes support once the modal has gone. The payment itself
 * keeps running; the consumer navigates on its result as usual.
 */
export function PaymentProcessingOverlay({ phase, orderId }: PaymentProcessingOverlayProps) {
  const content = isVisiblePhase(phase) ? PHASE_CONTENT[phase] : null;
  const visible = content !== null;
  const escalatable = phase === "verifying" || phase === "reconciling";

  const [slow, setSlow] = useState(false);
  const [helpRequested, setHelpRequested] = useState(false);
  // Set by "Need help?"; consumed once the modal has actually been dismissed.
  const pendingHelpPush = useRef(false);

  useEffect(() => {
    if (!escalatable) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), ESCALATE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [escalatable]);

  // The flow ended (or the gateway took over): the next payment shows the overlay again.
  useEffect(() => {
    if (!visible) setHelpRequested(false);
  }, [visible]);

  const flushHelpPush = useCallback(() => {
    if (!pendingHelpPush.current) return;
    pendingHelpPush.current = false;
    // Pure navigation — silent (CONTRACTS §8).
    router.push({ pathname: "/settings/support", params: orderId ? { orderId } : {} });
  }, [orderId]);

  const onNeedHelp = useCallback(() => {
    pendingHelpPush.current = true;
    setHelpRequested(true);
    // RN Modal.onDismiss fires on iOS only; Android gets one frame for the
    // dialog window to go away before the push (same recipe as BottomSheet).
    if (Platform.OS !== "ios") requestAnimationFrame(flushHelpPush);
  }, [flushHelpPush]);

  return (
    <Modal
      visible={visible && !helpRequested}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        // Swallow Android back-press while a payment is in flight.
      }}
      onDismiss={flushHelpPush}
    >
      {content ? (
        <View style={styles.backdrop} accessibilityViewIsModal>
          <View style={styles.card} accessibilityState={{ busy: true }}>
            <View style={styles.stage}>
              <Pulse
                size={HALO_SIZE}
                color={C.primaryLight}
                active
                fromScale={0.88}
                toScale={1.22}
                fromOpacity={0.6}
                style={styles.halo}
              />
              <View style={styles.disc}>
                {/* Keyed on the glyph so a phase change crossfades the icons (M22). */}
                <Animated.View key={content.icon} entering={enter.fade()} exiting={exit.fade()} style={styles.iconLayer}>
                  <MaterialCommunityIcons name={content.icon} size={ICON_SIZE} color={C.primary} />
                </Animated.View>
              </View>
            </View>

            <Animated.View layout={layoutTiming()} style={styles.copy}>
              <Animated.View key={phase} entering={enter.fade()} style={styles.copyInner}>
                <Text
                  style={styles.title}
                  accessibilityRole="header"
                  accessibilityLiveRegion="polite"
                  maxFontSizeMultiplier={1.3}
                >
                  {content.title}
                </Text>
                <Text style={styles.subtitle} maxFontSizeMultiplier={1.3}>
                  {content.subtitle}
                </Text>
              </Animated.View>

              {slow ? (
                <Animated.View entering={enter.fade()} style={styles.slowBlock}>
                  <Text style={styles.slowText} accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3}>
                    Taking longer than usual — don&apos;t close the app
                  </Text>
                  <PrimaryButton
                    size="xs"
                    variant="ghost"
                    label="Need help?"
                    onPress={onNeedHelp}
                    accessibilityLabel="Need help? Open support for this order"
                    testID="payment-overlay-help"
                  />
                </Animated.View>
              ) : null}
            </Animated.View>

            <View style={styles.secureRow}>
              <MaterialCommunityIcons name="lock-outline" size={13} color={C.textSub} />
              <Text style={styles.secureText} maxFontSizeMultiplier={1.3}>
                256-bit secure · Powered by Razorpay
              </Text>
            </View>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: C.scrim,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[28],
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: C.card,
    borderRadius: radius.xxxl,
    paddingHorizontal: space[24],
    paddingTop: space[32],
    paddingBottom: space[24],
    alignItems: "center",
    ...shadow.cardLg,
  },
  stage: {
    width: HALO_SIZE,
    height: HALO_SIZE,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space[16],
  },
  halo: { position: "absolute", top: 0, left: 0 },
  disc: {
    width: DISC_SIZE,
    height: DISC_SIZE,
    borderRadius: DISC_SIZE / 2,
    backgroundColor: C.primaryXLight,
    alignItems: "center",
    justifyContent: "center",
  },
  iconLayer: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  copy: { alignSelf: "stretch", alignItems: "center" },
  copyInner: { alignSelf: "stretch", alignItems: "center" },
  title: { ...text.screenTitle, textAlign: "center", marginBottom: space[8] },
  subtitle: { ...text.bodySm, textAlign: "center" },
  slowBlock: { marginTop: space[16], alignItems: "center", gap: space[6] },
  slowText: { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 18, color: C.text, textAlign: "center" },
  secureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[6],
    marginTop: space[20],
    paddingTop: space[12],
    borderTopWidth: 1,
    borderTopColor: C.border,
    width: "100%",
    justifyContent: "center",
  },
  secureText: { ...text.label },
});
