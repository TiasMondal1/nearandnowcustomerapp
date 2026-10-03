// codename: indigo
// Floating "DEV" pill (CONTRACTS §5, design §4.3): 48×28 r999 `C.text` capsule with an env dot, draggable anywhere,
// snapping to the nearest horizontal edge on release, remembering its position in `nn:dev:pill`, never overlapping the
// CartBar (its default and its vertical clamp compose `useCartBarLayout()`), hidden while a payment is in flight.
// It is the only always-visible trace of dev mode, so it is deliberately near-black, not brand green.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useState, useSyncExternalStore } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { C } from "../../constants/colors";
import { fontFamily, motion, radius, shadow, TAB_BAR_BASE_HEIGHT } from "../../constants/ui";
import { getPaymentPhaseSync, subscribePaymentPhase } from "../../hooks/usePaymentFlow";
import { getBuildProfile, type BuildProfile } from "../../lib/appExtra";
import { DEV_STORAGE_KEYS, resetDevFlags } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import { logSilentFailure } from "../../lib/logSilentFailure";
import { PressableScale, notify, spr, useCartBarLayout, useDockHeight, useMotionReduced } from "../ui";

export type DevPillProps = {
  /** Tap (after `feedback.tap()`, haptic only — the sheet's swoosh is the gesture's sound): the host opens the panel, or the PIN sheet while locked. */
  onPress: () => void;
  /** Flags differing from their default; > 0 shows the amber badge and feeds the long-press toast. */
  changedCount: number;
  /** true in `__DEV__` builds before the PIN was entered: the env dot becomes a lock glyph and the hint says so. */
  locked: boolean;
};

// ─── Geometry (px) ────────────────────────────────────────────────────────────

/** Pill size. */
export const DEV_PILL_WIDTH = 48;
export const DEV_PILL_HEIGHT = 28;
/** Distance kept from the left/right window edge when snapped. */
const EDGE_GAP = 12;
/** Vertical clamp: the pill's top never goes above `insets.top + 56` (clear of headers)… */
const TOP_RESERVE = 56;
/** …nor below `height − dockHeight − 96` (clear of docks / the tab bar). */
const BOTTOM_RESERVE = 96;
/** Default bottom offset above the tab bar: `TAB_BAR_BASE_HEIGHT + insets.bottom + 84` (also clear of Home's active-orders banner). */
const DEFAULT_ABOVE_TABS = 84;
/** Gap kept above the CartBar (default position and clamp). */
const CART_BAR_GAP_ABOVE = 12;
/** Finger travel before the pan claims the touch — taps and the 600 ms long-press go to the Pressable below it. */
const PAN_ACTIVE_OFFSET = 6;
/** Long-press delay (design §4.3). */
const LONG_PRESS_MS = 600;
/** Fling bias: velocity (px/s) × this (s) is added to the centre before choosing the snap edge. */
const FLING_LOOKAHEAD_S = 0.05;
/** Above ToastHost (60) and CartBar (50); below the simulation stripe (80). */
const PILL_Z_INDEX = 70;
/** Env dot diameter. */
const DOT = 6;
/** Badge: 16 px tall (11 px type needs 16 — D10 forbids text under 11 px, so the contract's 14 px grows by 2). */
const BADGE = 16;

type Pos = { x: number; y: number };
type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

const ENV_DOT: Record<BuildProfile, string> = {
  local: C.textLight,
  development: C.info,
  preview: C.warning,
  production: C.danger,
};

function clamp(v: number, lo: number, hi: number): number {
  "worklet";
  return Math.min(hi, Math.max(lo, v));
}

function parseStoredPos(raw: string | null): Pos | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "x" in parsed && "y" in parsed) {
      const { x, y } = parsed as { x: unknown; y: unknown };
      if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    }
  } catch {
    // A corrupt blob means "no stored position" — the default is fine.
  }
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Last known position for this JS session: `undefined` until the first `nn:dev:pill` read settles, then the stored (or
 * `null` = default) position, updated on every drag. `DevPanelHost` remounts the pill whenever the panel / PIN sheet
 * opens or a payment ends, so seeding state from here lets a remount paint on its first frame instead of blinking.
 */
let cachedPos: Pos | null | undefined;

/**
 * Reads `nn:dev:pill` once per session, hides while `getPaymentPhaseSync() !== 'idle'` (subscribed), then mounts
 * `PillBody` with the stored or default position so there is no first-frame jump. Rendered by `DevPanelHost` only.
 */
export function DevPill(props: DevPillProps): React.JSX.Element | null {
  const [stored, setStored] = useState<Pos | null | undefined>(() => cachedPos);
  const paymentPhase = useSyncExternalStore(subscribePaymentPhase, getPaymentPhaseSync, getPaymentPhaseSync);

  useEffect(() => {
    if (cachedPos !== undefined) return;
    let cancelled = false;
    AsyncStorage.getItem(DEV_STORAGE_KEYS.pill)
      .then((raw) => {
        // Seed the cache even when unmounted meanwhile, unless a drag already persisted a newer position.
        if (cachedPos === undefined) cachedPos = parseStoredPos(raw);
        if (!cancelled) setStored(cachedPos);
      })
      .catch((err) => {
        logSilentFailure("DevPill.load", err);
        if (cachedPos === undefined) cachedPos = null;
        if (!cancelled) setStored(cachedPos);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleMoved = (pos: Pos) => {
    cachedPos = pos;
    setStored(pos);
  };

  if (stored === undefined || paymentPhase !== "idle") return null;
  return <PillBody {...props} initial={stored} onMoved={handleMoved} />;
}

type PillBodyProps = DevPillProps & { initial: Pos | null; onMoved: (pos: Pos) => void };

/**
 * Default: right edge (`right: 12`), `bottom = max(TAB_BAR_BASE_HEIGHT + insets.bottom + 84, cartBar.bottom +
 * cartBar.height + 12)`. Pan: follows the finger; on release the x snaps to the nearer edge `withSpring(spr(gentle))`
 * (velocity biased), y is clamped to `[insets.top + 56, min(height − dockHeight − 96, above the CartBar)]`, and the
 * result is persisted best-effort. Re-clamped whenever the window, insets, dock or CartBar layout change.
 */
function PillBody({ onPress, changedCount, locked, initial, onMoved }: PillBodyProps): React.JSX.Element {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const cartBar = useCartBarLayout();
  const dockHeight = useDockHeight();
  const reduced = useMotionReduced();

  const cartBarTop = cartBar.bottom + cartBar.height + CART_BAR_GAP_ABOVE;
  const minX = EDGE_GAP;
  const maxX = Math.max(minX, width - EDGE_GAP - DEV_PILL_WIDTH);
  const minY = insets.top + TOP_RESERVE;
  const maxY = Math.max(
    minY,
    Math.min(height - dockHeight - BOTTOM_RESERVE, cartBar.visible ? height - cartBarTop - DEV_PILL_HEIGHT : Number.POSITIVE_INFINITY),
  );
  const defaultBottom = Math.max(TAB_BAR_BASE_HEIGHT + insets.bottom + DEFAULT_ABOVE_TABS, cartBarTop);
  const start: Pos = initial ?? { x: maxX, y: height - defaultBottom - DEV_PILL_HEIGHT };

  const x = useSharedValue(clamp(start.x, minX, maxX));
  const y = useSharedValue(clamp(start.y, minY, maxY));
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const gentle = spr(motion.spring.gentle);

  // Re-clamp (and re-snap x) when the geometry it was clamped against changes (window, insets, dock, CartBar).
  useEffect(() => {
    const bounds: Bounds = { minX, maxX, minY, maxY };
    const spring = spr(motion.spring.gentle);
    const cx = x.get() + DEV_PILL_WIDTH / 2;
    const nx = cx < width / 2 ? bounds.minX : bounds.maxX;
    const ny = clamp(y.get(), bounds.minY, bounds.maxY);
    if (nx !== x.get()) x.set(reduced ? nx : withSpring(nx, spring));
    if (ny !== y.get()) y.set(reduced ? ny : withSpring(ny, spring));
  }, [minX, maxX, minY, maxY, width, reduced, x, y]);

  const persist = (nx: number, ny: number) => {
    const pos = { x: nx, y: ny };
    onMoved(pos);
    AsyncStorage.setItem(DEV_STORAGE_KEYS.pill, JSON.stringify(pos)).catch((err) => logSilentFailure("DevPill.persist", err));
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-PAN_ACTIVE_OFFSET, PAN_ACTIVE_OFFSET])
    .activeOffsetY([-PAN_ACTIVE_OFFSET, PAN_ACTIVE_OFFSET])
    .onStart(() => {
      "worklet";
      startX.set(x.get());
      startY.set(y.get());
    })
    .onUpdate((e) => {
      "worklet";
      x.set(startX.get() + e.translationX);
      y.set(startY.get() + e.translationY);
    })
    .onEnd((e) => {
      "worklet";
      const centre = x.get() + DEV_PILL_WIDTH / 2 + e.velocityX * FLING_LOOKAHEAD_S;
      const nx = centre < width / 2 ? minX : maxX;
      const ny = clamp(y.get(), minY, maxY);
      x.set(reduced ? nx : withSpring(nx, gentle));
      y.set(reduced ? ny : withSpring(ny, gentle));
      scheduleOnRN(persist, nx, ny);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { translateY: y.get() }],
  }));

  const handlePress = () => {
    feedback.tap();
    onPress();
  };

  const handleLongPress = () => {
    feedback.heavy();
    if (changedCount === 0) {
      notify({ id: "dev-pill", title: "No flags changed", tone: "neutral" });
      return;
    }
    notify({
      id: "dev-pill",
      title: `${changedCount} ${changedCount === 1 ? "flag" : "flags"} changed`,
      tone: "neutral",
      action: {
        label: "Reset",
        onPress: () => {
          resetDevFlags()
            .then(() => feedback.toggle(false))
            .catch((err) => logSilentFailure("DevPill.resetFlags", err));
        },
      },
    });
  };

  const hint = locked
    ? "Opens the developer PIN"
    : changedCount > 0
      ? `Opens the developer panel. ${changedCount} flags changed; long press to reset`
      : "Opens the developer panel";

  return (
    <View style={styles.layer} pointerEvents="box-none" testID="dev-pill-layer">
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.anchor, animatedStyle]}>
          <PressableScale
            scale={motion.scale.icon}
            haptic={false}
            onPress={handlePress}
            onLongPress={handleLongPress}
            delayLongPress={LONG_PRESS_MS}
            accessibilityRole="button"
            accessibilityLabel="Developer menu"
            accessibilityHint={hint}
            innerStyle={styles.pill}
            pressedStyle={styles.pillPressed}
            testID="dev-pill"
          >
            {locked ? (
              <MaterialCommunityIcons name="lock" size={11} color={C.white} />
            ) : (
              <View style={[styles.dot, { backgroundColor: ENV_DOT[getBuildProfile()] }]} />
            )}
            <Text style={styles.label} maxFontSizeMultiplier={1}>
              DEV
            </Text>
          </PressableScale>
          {changedCount > 0 ? (
            <View style={styles.badge} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no">
              <Text style={styles.badgeText} maxFontSizeMultiplier={1}>
                {changedCount > 99 ? "99+" : changedCount}
              </Text>
            </View>
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, zIndex: PILL_Z_INDEX, elevation: PILL_Z_INDEX },
  anchor: { position: "absolute", left: 0, top: 0, width: DEV_PILL_WIDTH, height: DEV_PILL_HEIGHT },
  pill: {
    width: DEV_PILL_WIDTH,
    height: DEV_PILL_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: C.text,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    ...shadow.cardLg,
  },
  pillPressed: { backgroundColor: C.textSub },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  label: { fontFamily: fontFamily.bold, fontSize: 11, lineHeight: 13, color: C.white, letterSpacing: 0.4 },
  badge: {
    position: "absolute",
    top: -BADGE / 3,
    right: -BADGE / 3,
    minWidth: BADGE,
    height: BADGE,
    paddingHorizontal: 3,
    borderRadius: BADGE / 2,
    backgroundColor: C.warning,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontFamily: fontFamily.bold, fontSize: 11, lineHeight: 13, color: C.text },
});
