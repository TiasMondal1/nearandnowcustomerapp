// codename: nova
// SuccessHeader — THE order-placed moment (design/blinkit-parity §3.10 · motion M10 · CONTRACTS §7 / §8). A 96 px
// check circle pops 0 → 1.15 → 1 on `spring.pop` with a one-shot Pulse ring, Confetti bursts at t = 150 ms clipped to
// the band, the copy rises in at 120 / 200 / 280 ms, and exactly ONE `success` feedback plays per order id for every
// payment mode (haptic + chime; `Dev_Nova_inhibit_Chime` drops the chime alone). Checkout fires nothing on success —
// this component is the single owner of the order-placed feedback (PLAN §5 rule 5).
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from "react-native-reanimated";

import { C } from "../../constants/colors";
import { fontFamily, iconSize, motion, shadow, text } from "../../constants/ui";
import { useDeliveryEta } from "../../hooks/useDeliveryEta";
import { getDevFlag, useDevFlag } from "../../lib/devFlags";
import { haptic, sound } from "../../lib/feedback";
import { Confetti, IconButton, Pulse, dur, enter, spr, useMotionReduced } from "../ui";

/** Orders older than this are not celebrated again (a push / deep link into an old order in a new JS session — W3 R2-20). */
export const CELEBRATION_MAX_AGE_MS = 10 * 60_000;

export type SuccessHeaderProps = {
  /** `Date.parse(order.created_at)`; when older than 10 min the pop / confetti / chime / haptic are skipped. Default: celebrate. */
  placedAtMs?: number;
  /** The order being celebrated — the feedback / pop / confetti play once per id for the life of the JS session. */
  orderId: string;
  /** Shown as `#${orderNumber}` (the order code, or the id prefix when the backend sent none). */
  orderNumber: string;
  /** Top-right close (silent navigation) — the screen routes it to Home. */
  onClose: () => void;
  /** `insets.top`; the band runs under the status bar and pays the inset itself (paddingTop = inset + 24). */
  topInset: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Diameter of the white check circle. */
const CIRCLE_SIZE = 96;
/** Check glyph size inside the circle. */
const CHECK_SIZE = 48;
/** Band paddings (design §3.10): paddingTop = inset + 24, paddingBottom 28. */
const BAND_PADDING_TOP = 24;
const BAND_PADDING_BOTTOM = 28;
const BAND_PADDING_X = 24;
/** Confetti starts this long after the check pops (M10 timeline). */
const CONFETTI_DELAY_MS = 150;
/** One-shot ring cycle (M10: 0.6 → 1.9 over 600 ms). */
const RING_MS = 600;
const RING_FROM_SCALE = 0.6;
const RING_TO_SCALE = 1.9;
const RING_FROM_OPACITY = 0.35;
/** Overshoot of the check pop before it settles to 1. */
const POP_OVERSHOOT = 1.15;
/** Copy stagger delays (M10: 120 / 200 / 280 ms — `motion.stagger` 60 ms steps after a 60 ms lead). */
const STAGGER_TITLE_MS = 120;
const STAGGER_NUMBER_MS = 200;
const STAGGER_ETA_MS = 280;
/** Close button offset inside the band. */
const CLOSE_INSET = 8;

/**
 * Order ids whose celebration already played in this JS session. Module-scoped (not a ref) because the guard must
 * survive a RE-MOUNT of the same order — back/forward through tracking, a repeated deep link — so the chime never
 * replays for an order the customer already heard. Read in a `useState` initializer and written in an effect only.
 */
const celebratedOrderIds = new Set<string>();

/**
 * The success band. Renders only once an order is on screen (the screen gates it), so the celebration never fires for
 * a skeleton or an error state. Visuals follow the motion flags (`Dev_Nova_inhibit_Feature` / `_CheckPop` /
 * `_Confetti`, reduced motion → static check, no ring, no confetti, instant copy); the haptic always plays, the chime
 * unless `Dev_Nova_inhibit_Chime` or `Dev_Nova_inhibit_Feature`.
 */
export function SuccessHeader({ placedAtMs, orderId, orderNumber, onClose, topInset, style, testID }: SuccessHeaderProps): React.JSX.Element {
  const reduced = useMotionReduced();
  const inhibitFeature = useDevFlag("Dev_Nova_inhibit_Feature");
  const inhibitCheckPop = useDevFlag("Dev_Nova_inhibit_CheckPop");
  const inhibitConfetti = useDevFlag("Dev_Nova_inhibit_Confetti");
  const eta = useDeliveryEta();

  // Latched per mount from the module guard: true only for the FIRST mount of this order id in the session, and
  // never for an order placed more than 10 min ago (the clock is read once, in the initializer — MAP C46).
  const [celebrate] = useState(
    () =>
      !celebratedOrderIds.has(orderId) &&
      !(placedAtMs != null && Number.isFinite(placedAtMs) && Date.now() - placedAtMs > CELEBRATION_MAX_AGE_MS),
  );
  const popEnabled = celebrate && !reduced && !inhibitFeature && !inhibitCheckPop;
  const confettiEnabled = celebrate && !reduced && !inhibitFeature && !inhibitConfetti;
  const staggerEnabled = celebrate && !inhibitFeature;

  const [confettiOn, setConfettiOn] = useState(false);
  const [bandWidth, setBandWidth] = useState(0);
  // The feedback must fire exactly once even if the effect re-runs (dev double-invoke); the motion may re-arm.
  const feedbackFiredRef = useRef(false);
  // Starts collapsed only when it will pop; otherwise the check is simply there (reduced motion / flags / re-mount).
  const scale = useSharedValue(popEnabled ? 0 : 1);

  useEffect(() => {
    if (!celebrate) return;
    if (!feedbackFiredRef.current) {
      feedbackFiredRef.current = true;
      celebratedOrderIds.add(orderId);
      // Low-level calls instead of feedback.success() so the chime flag can drop the sound while the haptic stays
      // (CONTRACTS §2.1). Fired before any animation so it lands with the first frame.
      haptic("success");
      if (!getDevFlag("Dev_Nova_inhibit_Chime") && !getDevFlag("Dev_Nova_inhibit_Feature")) sound("success");
    }
    if (popEnabled) {
      scale.set(0);
      scale.set(withSequence(withSpring(POP_OVERSHOOT, spr(motion.spring.pop)), withSpring(1, spr(motion.spring.press))));
    } else {
      scale.set(1);
    }
    if (!confettiEnabled) return;
    const timer = setTimeout(() => setConfettiOn(true), dur(CONFETTI_DELAY_MS));
    return () => clearTimeout(timer);
    // Once per order id: re-running on a flag flip mid-screen would replay the pop/confetti for an order already
    // celebrated. `celebrate` is a per-mount latch and the enabled flags are read at mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const handleLayout = (e: LayoutChangeEvent) => {
    setBandWidth(e.nativeEvent.layout.width);
  };

  const arriving = eta.state === "open" && eta.minutes != null ? `arriving in about ${eta.minutes} minutes` : null;
  const etaCopy = arriving ? `⚡ Arriving in about ${eta.minutes} minutes` : "We'll let you know when it's on the way";
  const liveLabel = `Order placed, ${arriving ?? "we'll let you know when it's on the way"}`;
  const circleCentreY = topInset + BAND_PADDING_TOP + CIRCLE_SIZE / 2;
  const confettiOrigin = bandWidth > 0 ? { x: bandWidth / 2, y: circleCentreY } : undefined;

  // Reduced motion: reanimated's own ReduceMotion.System turns every entering animation instant, so passing the
  // fade here is enough for "texts fade 120 ms" where the OS allows it and nothing where it does not.
  const entering = (delayMs: number) => {
    if (!staggerEnabled) return undefined;
    return reduced ? enter.fade() : enter.rise().delay(dur(delayMs));
  };

  return (
    <View
      onLayout={handleLayout}
      style={[styles.band, { paddingTop: topInset + BAND_PADDING_TOP }, style]}
      testID={testID}
    >
      <View style={styles.checkWrap}>
        <Pulse
          size={CIRCLE_SIZE}
          color={C.primary}
          once
          active={popEnabled}
          period={RING_MS}
          fromScale={RING_FROM_SCALE}
          toScale={RING_TO_SCALE}
          fromOpacity={RING_FROM_OPACITY}
          style={styles.ring}
        />
        <Animated.View style={[styles.circle, popStyle]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <MaterialCommunityIcons name="check" size={CHECK_SIZE} color={C.primary} />
        </Animated.View>
      </View>

      <View accessible accessibilityRole="header" accessibilityLiveRegion="polite" accessibilityLabel={liveLabel} style={styles.copy}>
        <Animated.Text entering={entering(STAGGER_TITLE_MS)} style={styles.title} maxFontSizeMultiplier={1.3}>
          Order placed
        </Animated.Text>
        <Animated.Text entering={entering(STAGGER_NUMBER_MS)} style={styles.orderNumber} maxFontSizeMultiplier={1.3}>
          #{orderNumber}
        </Animated.Text>
        <Animated.Text entering={entering(STAGGER_ETA_MS)} style={styles.eta} maxFontSizeMultiplier={1.3} numberOfLines={2}>
          {etaCopy}
        </Animated.Text>
      </View>

      <IconButton
        icon="close"
        bg="transparent"
        iconSize={iconSize.xl}
        accessibilityLabel="Close"
        onPress={onClose}
        style={[styles.close, { top: topInset + CLOSE_INSET }]}
        testID={testID ? `${testID}-close` : undefined}
      />

      {/* Confetti clip: a flat absolute layer with overflow hidden so the burst never leaves the band. It is a SIBLING
          of the elevated circle, never its parent (Android drops elevation under overflow:hidden — MAP §7.4). */}
      <View pointerEvents="none" style={styles.confettiClip}>
        {confettiOn ? <Confetti origin={confettiOrigin} onDone={() => setConfettiOn(false)} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    alignItems: "center",
    backgroundColor: C.primaryXLight,
    paddingHorizontal: BAND_PADDING_X,
    paddingBottom: BAND_PADDING_BOTTOM,
  },
  checkWrap: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: { position: "absolute" },
  circle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  copy: { alignItems: "center", marginTop: 20 },
  title: { ...text.h1, textAlign: "center" },
  orderNumber: { fontFamily: fontFamily.bold, fontSize: 14, lineHeight: 20, color: C.textSub, marginTop: 6, textAlign: "center" },
  eta: { fontFamily: fontFamily.semibold, fontSize: 14, lineHeight: 20, color: C.primary, marginTop: 8, textAlign: "center" },
  close: { position: "absolute", right: CLOSE_INSET },
  confettiClip: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
});
