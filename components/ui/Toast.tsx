// codename: vulcan
// Non-blocking toast / snackbar system (CONTRACTS §4.4).
//
// Layering model (rev. 2): the queue is a module store so `notify()` works from lib/ and contexts; `ToastHost` is a PLAIN
// absolute View mounted once as a sibling of <Stack> — never an RN Modal, because a Modal has no touch pass-through and
// would freeze the app for the toast's whole duration. Sheets (BottomSheet) are RN Modals that paint above the host, so
// each sheet renders its own `ToastLayer` inside its Modal and holds `registerToastLayer()`; while any overlay layer is
// registered the root host draws nothing, so a toast is never drawn twice and is always tappable where it is visible.
//
// Toasts are silent: the only feedback they emit is one `haptic('error')` for error/warning tones (gated 300 ms behind
// the last error haptic via `feedback.lastAt("error")`), and one `feedback.select()` when a swipe crosses the dismiss threshold.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { usePathname } from "expo-router";
import React, { useEffect, useRef, useSyncExternalStore } from "react";
import {
  AccessibilityInfo,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { C } from "../../constants/colors";
import { motion, radius, shadow, TAB_BAR_BASE_HEIGHT } from "../../constants/ui";
import { getDevFlag, useDevFlag } from "../../lib/devFlags";
import { feedback, haptic } from "../../lib/feedback";
import { useDockHeight } from "./BottomDock";
import { isTabPathname, useCartBarExtraBottom, useCartBarLayout } from "./CartBar";
import { dur, enter, exit, layoutTiming, spr, useLayoutTransitionsEnabled, useMotionReduced } from "./motion/presets";
import type { IconName } from "./types";

// ─── Public types ─────────────────────────────────────────────────────────────

export type ToastTone = "neutral" | "success" | "error" | "warning" | "info" | "deal";

export type ToastAction = { label: string; onPress: () => void };

export type ToastOptions = {
  /** Same id → the existing toast restarts its timer and nudges (scale 1.03 → 1) instead of a second toast stacking. */
  id?: string;
  /** 13/600 C.white, 2 lines max. */
  title: string;
  /** 12/400 C.onDarkSub under the title, 2 lines max. */
  message?: string;
  /** Default 'neutral'. Picks the default glyph and its colour; 'error' also sets accessibilityRole="alert". */
  tone?: ToastTone;
  /** Default by tone: check-circle (success) / alert-circle (error, warning) / information-outline (neutral, info) / ticket-percent-outline (deal). */
  icon?: IconName;
  /** Auto-dismiss delay in ms. Default TOAST_DURATION.base (2800), or TOAST_DURATION.withAction (5000) when `action` is set. */
  duration?: number;
  /** Trailing text button (e.g. Undo): 13/700 C.primaryLight, 44 pt target, 2 px underline that shrinks over `duration`. Pressing it dismisses the toast. */
  action?: ToastAction;
  /** Whole-toast tap (the dev version toast uses it). A plain Pressable: no haptic, no sound. */
  onPress?: () => void;
  /** Default: true only for 'error' / 'warning'. When true, fires `haptic("error")` unless an error haptic fired < 300 ms ago (`feedback.lastAt("error")`). Toasts NEVER play sounds. */
  haptic?: boolean;
  /** No auto-dismiss: leaves only by swipe, its action, or dismissToast(). Also forced for every toast by Dev_Vulcan_inhibit_AutoDismiss. */
  persistent?: boolean;
};

export const TOAST_DURATION = { base: 2800, withAction: 5000 } as const;

// ─── Module constants ─────────────────────────────────────────────────────────

/** Toasts visible at once; a third `notify()` evicts the oldest. */
const MAX_VISIBLE = 2;
/** Vertical gap between stacked toasts (px). */
const STACK_GAP = 8;
/** Horizontal travel over which a swiped toast fades to transparent (px); opacity = 1 − |x| / 160. */
const SWIPE_FADE_DISTANCE = 160;
/** Downward travel a swipe-down flings to before the toast is removed (px). */
const SWIPE_DOWN_EXIT = 240;
/** Minimum time a toast stays after the finger lifts when its timer ran out while held (ms). */
const RELEASE_GRACE_MS = 400;
/** `haptic("error")` is skipped when `feedback.lastAt("error")` is within this window (ms). */
const ERROR_HAPTIC_GAP_MS = 300;
/** Lifts the 13 px action label (≈ 26 pt tall) to a 44 pt target without growing the 48 pt pill. */
const ACTION_HIT_SLOP = { top: 10, bottom: 10, left: 8, right: 8 } as const;
/** Movement before the Pan claims the touch: 8 px sideways, or 8 px downward (upward drags do nothing). */
const PAN_ACTIVE_OFFSET = 8;

const TONE_ICON: Record<ToastTone, IconName> = {
  neutral: "information-outline",
  success: "check-circle",
  error: "alert-circle",
  warning: "alert-circle",
  info: "information-outline",
  deal: "ticket-percent-outline",
};

const TONE_COLOR: Record<ToastTone, string> = {
  neutral: C.white,
  success: C.primaryLight,
  error: C.dangerBorder,
  warning: C.warningBorder,
  info: C.white,
  deal: C.dealLight,
};

// ─── Module store (queue + overlay-layer counter) ─────────────────────────────

type ToastRecord = {
  id: string;
  title: string;
  message?: string;
  tone: ToastTone;
  icon: IconName;
  /** Resolved auto-dismiss delay in ms (ignored while persistent). */
  duration: number;
  action?: ToastAction;
  onPress?: () => void;
  persistent: boolean;
  /** Bumped on every same-id re-notify so the mounted item restarts its timer and nudges. */
  nonce: number;
};

let queue: readonly ToastRecord[] = [];
let seq = 0;
const queueListeners = new Set<() => void>();

function emitQueue(): void {
  queueListeners.forEach((listener) => listener());
}

function subscribeQueue(listener: () => void): () => void {
  queueListeners.add(listener);
  return () => {
    queueListeners.delete(listener);
  };
}

function getQueue(): readonly ToastRecord[] {
  return queue;
}

let overlayLayers = 0;
const layerListeners = new Set<() => void>();

function emitLayers(): void {
  layerListeners.forEach((listener) => listener());
}

function subscribeLayers(listener: () => void): () => void {
  layerListeners.add(listener);
  return () => {
    layerListeners.delete(listener);
  };
}

function getOverlayLayers(): number {
  return overlayLayers;
}

function buildRecord(opts: ToastOptions, id: string, nonce: number): ToastRecord {
  const tone = opts.tone ?? "neutral";
  return {
    id,
    title: opts.title,
    message: opts.message,
    tone,
    icon: opts.icon ?? TONE_ICON[tone],
    duration: opts.duration ?? (opts.action ? TOAST_DURATION.withAction : TOAST_DURATION.base),
    action: opts.action,
    onPress: opts.onPress,
    persistent: opts.persistent ?? false,
    nonce,
  };
}

function recordToOptions(record: ToastRecord): ToastOptions {
  return {
    id: record.id,
    title: record.title,
    message: record.message,
    tone: record.tone,
    icon: record.icon,
    duration: record.duration,
    action: record.action,
    onPress: record.onPress,
    persistent: record.persistent,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Shows a toast and returns its id. Usable from lib/ and contexts (module emitter).
 * Same `id` → restarts that toast's timer and nudges it instead of stacking; otherwise the newest toast appears at the
 * bottom of the stack, pushing the older one up, and a third evicts the oldest (max 2 visible).
 * Under Dev_Vulcan_inhibit_Feature → `Alert.alert(title, message, [action?, OK])` and returns ''.
 */
export function notify(opts: ToastOptions): string {
  // The toast-owned error haptic fires BEFORE the Vulcan Alert fallback: the flag swaps the surface only (W3 R4-14).
  const tone = opts.tone ?? "neutral";
  const wantsHaptic = opts.haptic ?? (tone === "error" || tone === "warning");
  if (wantsHaptic && Date.now() - feedback.lastAt("error") > ERROR_HAPTIC_GAP_MS) haptic("error");

  if (getDevFlag("Dev_Vulcan_inhibit_Feature")) {
    Alert.alert(
      opts.title,
      opts.message,
      opts.action ? [{ text: opts.action.label, onPress: opts.action.onPress }, { text: "OK" }] : undefined,
    );
    return "";
  }

  const id = opts.id ?? `toast-${++seq}`;
  const existingIndex = queue.findIndex((t) => t.id === id);
  if (existingIndex >= 0) {
    const next = queue.slice();
    next[existingIndex] = buildRecord(opts, id, queue[existingIndex].nonce + 1);
    queue = next;
  } else {
    const next = [...queue, buildRecord(opts, id, 0)];
    queue = next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next;
  }
  emitQueue();
  return id;
}

/** Dismisses one toast by id, or every toast when `id` is omitted. Silent. */
export function dismissToast(id?: string): void {
  if (id === undefined) {
    if (queue.length === 0) return;
    queue = [];
  } else {
    const next = queue.filter((t) => t.id !== id);
    if (next.length === queue.length) return;
    queue = next;
  }
  emitQueue();
}

/** Patches a visible toast in place (title, message, action…). Does not restart its timer unless `duration` is patched. */
export function updateToast(id: string, patch: Partial<ToastOptions>): void {
  const index = queue.findIndex((t) => t.id === id);
  if (index < 0) return;
  const current = queue[index];
  const next = queue.slice();
  next[index] = buildRecord({ ...recordToOptions(current), ...patch, id, title: patch.title ?? current.title }, id, current.nonce);
  queue = next;
  emitQueue();
}

const TOAST_API = { show: notify, dismiss: dismissToast } as const;

/** `{ show, dismiss }` — the same module functions, for call sites that prefer a hook-shaped API. Stable identity. */
export function useToast(): { show: typeof notify; dismiss: typeof dismissToast } {
  return TOAST_API;
}

/**
 * Registers an overlay toast layer (BottomSheet calls it while its Modal is mounted). While at least one layer is
 * registered the root `ToastHost` renders nothing, so a toast is drawn exactly once — inside the topmost overlay.
 * Returns the release function (idempotent).
 */
export function registerToastLayer(): () => void {
  overlayLayers += 1;
  emitLayers();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    overlayLayers = Math.max(0, overlayLayers - 1);
    emitLayers();
  };
}

// ─── Hosts ────────────────────────────────────────────────────────────────────

/**
 * Root host: a PLAIN absolute View (`left/right 0`, `pointerEvents: box-none`, zIndex/elevation 60 — above CartBar's 50),
 * mounted once in AppShell as a sibling of <Stack>. NOT a Modal. Renders `<ToastLayer/>` only while no overlay layer is
 * registered. Bottom = base + 8, where base = CartBar top when the bar is visible, otherwise the active dock height, or
 * the tab bar (TAB_BAR_BASE_HEIGHT + insets.bottom) on tab routes, or insets.bottom — each of those + 12.
 */
export function ToastHost(): React.JSX.Element {
  const layers = useSyncExternalStore(subscribeLayers, getOverlayLayers, getOverlayLayers);
  const pathname = usePathname();
  const cartBar = useCartBarLayout();
  // Home's active-orders banner lift is published independently of the bar's visibility (W3 R3-03).
  const lift = useCartBarExtraBottom();
  const dockHeight = useDockHeight();
  const insets = useSafeAreaInsets();

  const base = cartBar.visible
    ? cartBar.bottom + cartBar.height
    : (dockHeight > 0 ? dockHeight : isTabPathname(pathname) ? TAB_BAR_BASE_HEIGHT + insets.bottom + lift : insets.bottom) + 12;
  const bottom = base + STACK_GAP;

  return (
    <View style={[styles.host, { bottom }]} testID="toast-host">
      {layers === 0 ? <ToastLayer /> : null}
    </View>
  );
}

/**
 * The stack itself (max 2, 8 px gap, newest at the bottom). Consumes the same module queue as `ToastHost`.
 * Without `bottomOffset` it lays out in normal flow (the host positions it); with `bottomOffset` it is absolutely
 * positioned `left/right 0` at that distance from its parent's bottom — BottomSheet renders one INSIDE its Modal above
 * the panel so toasts fired over a sheet are visible and tappable. `pointerEvents: box-none` either way.
 */
export function ToastLayer({ bottomOffset, testID }: { bottomOffset?: number; testID?: string } = {}): React.JSX.Element {
  const toasts = useSyncExternalStore(subscribeQueue, getQueue, getQueue);
  const swipeInhibited = useDevFlag("Dev_Vulcan_inhibit_SwipeDismiss");
  const autoDismissInhibited = useDevFlag("Dev_Vulcan_inhibit_AutoDismiss");
  const reduced = useMotionReduced();
  const layoutOn = useLayoutTransitionsEnabled();
  const { width: screenWidth } = useWindowDimensions();

  return (
    <View style={[styles.layer, bottomOffset !== undefined && [styles.layerAbsolute, { bottom: bottomOffset }]]} testID={testID}>
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          swipeEnabled={!swipeInhibited}
          autoDismiss={!autoDismissInhibited && !toast.persistent}
          reduced={reduced}
          layoutOn={layoutOn}
          screenWidth={screenWidth}
        />
      ))}
    </View>
  );
}

// ─── Item ─────────────────────────────────────────────────────────────────────

type ToastItemProps = {
  toast: ToastRecord;
  /** false under Dev_Vulcan_inhibit_SwipeDismiss → no Pan gesture at all. */
  swipeEnabled: boolean;
  /** false when persistent or under Dev_Vulcan_inhibit_AutoDismiss → no timer, static underline. */
  autoDismiss: boolean;
  reduced: boolean;
  screenWidth: number;
  /** `useLayoutTransitionsEnabled()` from the layer: the stack re-flow snaps under Dev_Onyx_inhibit_LayoutTransitions (W3 R4-09). */
  layoutOn: boolean;
};

type HoldControls = { pause: () => void; resume: () => void };

function ToastItem({ toast, swipeEnabled, autoDismiss, reduced, screenWidth, layoutOn }: ToastItemProps): React.JSX.Element {
  const { id, duration, nonce } = toast;

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  /** Undo underline scaleX: 1 → 0 over the remaining time; static at 1 under reduced motion or without a timer. */
  const progress = useSharedValue(1);
  const crossed = useSharedValue(false);

  const holdRef = useRef<HoldControls | null>(null);
  const touchedRef = useRef(false);
  const panningRef = useRef(false);
  const dismissedRef = useRef(false);
  const prevNonceRef = useRef(nonce);

  // ── Auto-dismiss timer (JS). Restarts from the full duration on every same-id re-notify (nonce) ──
  useEffect(() => {
    if (!autoDismiss) {
      progress.set(1);
      holdRef.current = null;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let remaining = duration;
    let startedAt = 0;
    const stop = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const run = (ms: number) => {
      stop();
      remaining = ms;
      startedAt = Date.now();
      timer = setTimeout(() => {
        timer = null;
        dismissToast(id);
      }, ms);
      progress.set(reduced ? 1 : withTiming(0, { duration: ms, easing: Easing.linear }));
    };
    holdRef.current = {
      pause: () => {
        if (!timer) return;
        stop();
        remaining = Math.max(0, remaining - (Date.now() - startedAt));
        cancelAnimation(progress);
      },
      resume: () => {
        if (timer) return;
        run(Math.max(remaining, RELEASE_GRACE_MS));
      },
    };
    progress.set(1);
    run(duration);
    return () => {
      stop();
      cancelAnimation(progress);
      holdRef.current = null;
    };
  }, [id, duration, nonce, autoDismiss, reduced, progress]);

  // ── Re-notify nudge: withSequence(withSpring(1.03, pop), withSpring(1, press)); none under reduced motion ──
  useEffect(() => {
    if (prevNonceRef.current === nonce) return;
    prevNonceRef.current = nonce;
    if (reduced) return;
    scale.set(withSequence(withSpring(1.03, spr(motion.spring.pop)), withSpring(1, spr(motion.spring.press))));
  }, [nonce, reduced, scale]);

  // ── iOS has no live regions: announce once per show / re-notify (Android reads the layer's live region) ──
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    AccessibilityInfo.announceForAccessibility(toast.message ? `${toast.title}. ${toast.message}` : toast.title);
  }, [toast.title, toast.message, nonce]);

  // ── Hold bookkeeping: the timer pauses while the toast is touched (any touch) or being dragged ──
  const syncHold = () => {
    const held = touchedRef.current || panningRef.current;
    if (held) holdRef.current?.pause();
    else if (!dismissedRef.current) holdRef.current?.resume();
  };
  const setTouched = (touched: boolean) => {
    touchedRef.current = touched;
    syncHold();
  };
  const setPanning = (panning: boolean) => {
    panningRef.current = panning;
    syncHold();
  };

  const remove = () => {
    dismissedRef.current = true;
    dismissToast(id);
  };
  const onCross = () => feedback.select();
  const onPanStart = () => setPanning(true);
  const onPanEnd = () => setPanning(false);
  const onAction = () => {
    const action = toast.action;
    remove();
    action?.onPress();
  };

  // ── Swipe: horizontal follows the finger (opacity 1 − |x|/160); down also dismisses; up does nothing ──
  const dismissDistance = motion.swipeDismiss.distance;
  const dismissVelocity = motion.swipeDismiss.velocity;
  const flingMs = dur(motion.duration.fast);
  const backSpring = spr(motion.spring.press);

  const pan = Gesture.Pan()
    .enabled(swipeEnabled)
    .activeOffsetX([-PAN_ACTIVE_OFFSET, PAN_ACTIVE_OFFSET])
    .activeOffsetY(PAN_ACTIVE_OFFSET)
    .onStart(() => {
      "worklet";
      scheduleOnRN(onPanStart);
    })
    .onUpdate((e) => {
      "worklet";
      tx.set(e.translationX);
      ty.set(Math.max(0, e.translationY));
      const past = Math.abs(e.translationX) > dismissDistance || e.translationY > dismissDistance;
      if (past !== crossed.get()) {
        crossed.set(past);
        if (past) scheduleOnRN(onCross);
      }
    })
    .onEnd((e) => {
      "worklet";
      const flingX = Math.abs(e.translationX) > dismissDistance || Math.abs(e.velocityX) > dismissVelocity;
      const flingY = e.translationY > dismissDistance || e.velocityY > dismissVelocity;
      if (flingX) {
        const direction = e.translationX >= 0 ? 1 : -1;
        tx.set(
          withTiming(direction * screenWidth, { duration: flingMs }, (finished) => {
            if (finished) scheduleOnRN(remove);
          }),
        );
      } else if (flingY) {
        ty.set(
          withTiming(SWIPE_DOWN_EXIT, { duration: flingMs }, (finished) => {
            if (finished) scheduleOnRN(remove);
          }),
        );
      } else {
        tx.set(reduced ? 0 : withSpring(0, backSpring));
        ty.set(reduced ? 0 : withSpring(0, backSpring));
      }
    })
    .onFinalize(() => {
      "worklet";
      crossed.set(false);
      scheduleOnRN(onPanEnd);
    });

  const pillStyle = useAnimatedStyle(() => {
    const x = tx.get();
    const y = ty.get();
    const fade = 1 - Math.abs(x) / SWIPE_FADE_DISTANCE - y / SWIPE_DOWN_EXIT;
    return {
      opacity: Math.max(0, Math.min(1, fade)),
      transform: [{ translateX: x }, { translateY: y }, { scale: scale.get() }],
    };
  });

  const underlineStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.get() }] }));

  const isAlert = toast.tone === "error";
  const a11yLabel = toast.message ? `${toast.title}. ${toast.message}` : toast.title;

  const body = (
    <>
      <MaterialCommunityIcons name={toast.icon} size={18} color={TONE_COLOR[toast.tone]} />
      <View style={styles.textCol}>
        <Text style={styles.title} numberOfLines={2} maxFontSizeMultiplier={1.3}>
          {toast.title}
        </Text>
        {toast.message ? (
          <Text style={styles.message} numberOfLines={2} maxFontSizeMultiplier={1.3}>
            {toast.message}
          </Text>
        ) : null}
      </View>
      {toast.action ? (
        <Pressable
          onPress={onAction}
          hitSlop={ACTION_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={toast.action.label}
          style={styles.action}
          testID={`toast-${id}-action`}
        >
          {({ pressed }) => (
            <>
              <Text style={[styles.actionLabel, pressed && styles.actionLabelPressed]} maxFontSizeMultiplier={1.3}>
                {toast.action?.label}
              </Text>
              <Animated.View style={[styles.underline, underlineStyle]} />
            </>
          )}
        </Pressable>
      ) : null}
    </>
  );

  // Two Animated.Views on purpose: the OUTER one owns entering/exiting/layout, the INNER one owns the gesture-driven
  // transform, so a flung-away (already transparent) toast does not flash back to opacity 1 when its exit animation starts.
  const pill = (
    <Animated.View
      style={[styles.pill, pillStyle]}
      onTouchStart={() => setTouched(true)}
      onTouchEnd={() => setTouched(false)}
      onTouchCancel={() => setTouched(false)}
      accessibilityRole={isAlert ? "alert" : "none"}
      accessibilityLiveRegion="polite"
    >
      {toast.onPress ? (
        <Pressable onPress={toast.onPress} accessibilityRole="button" accessibilityLabel={a11yLabel} style={styles.row}>
          {body}
        </Pressable>
      ) : (
        <View style={styles.row}>{body}</View>
      )}
    </Animated.View>
  );

  return (
    <Animated.View entering={enter.drop()} exiting={exit.fall()} layout={layoutOn ? layoutTiming() : undefined} style={styles.slot} testID={`toast-${id}`}>
      {swipeEnabled ? <GestureDetector gesture={pan}>{pill}</GestureDetector> : pill}
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  host: { position: "absolute", left: 0, right: 0, zIndex: 60, elevation: 60, pointerEvents: "box-none" },
  layer: { gap: STACK_GAP, pointerEvents: "box-none" },
  layerAbsolute: { position: "absolute", left: 0, right: 0 },
  slot: { marginHorizontal: 16 },
  pill: { backgroundColor: C.text, borderRadius: radius.xl, minHeight: 48, ...shadow.cardLg },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48 },
  textCol: { flex: 1, gap: 2 },
  title: { fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 13, lineHeight: 18, color: C.white },
  message: { fontFamily: "PlusJakartaSans_400Regular", fontSize: 12, lineHeight: 16, color: C.onDarkSub },
  action: { paddingHorizontal: 6, paddingVertical: 4, alignItems: "stretch", justifyContent: "center" },
  actionLabel: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 13, lineHeight: 18, color: C.primaryLight, textAlign: "center" },
  actionLabelPressed: { color: C.white },
  underline: { height: 2, borderRadius: 1, marginTop: 2, backgroundColor: C.primaryLight, transformOrigin: "left" },
});
