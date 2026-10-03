// codename: altair
// Pan-to-dismiss bottom sheet (CONTRACTS §4.5). An RN Modal (transparent, statusBarTranslucent, animationType "none")
// whose direct child is a GestureHandlerRootView — on Android RNGH gestures inside an RN Modal are inert without their own
// root view (rev. 2). Inside it: the scrim, the panel, and a ToastLayer positioned above the panel so toasts fired while
// the sheet is open are visible and tappable; while mounted the sheet holds registerToastLayer() so the root ToastHost
// draws nothing (a toast is never drawn twice).
//
// Lifecycle: `mounted` (STATE, not a ref) flips true as soon as `visible` does and stays true through the exit animation;
// only then does the Modal close. `onDismiss` fires AFTER the native Modal is gone — on iOS from Modal.onDismiss, on
// Android (which has no Modal.onDismiss) one frame after the exit timing finished and the Modal unmounted. Callers
// `router.push` there, never in `onClose` (MAP §7.5: closing a Modal and pushing in the same tick freezes iOS).
//
// Elevation (MAP §7.4): the OUTER panel view carries shadow.sheet and NO overflow:hidden; an INNER view clips the top
// corners, so Android keeps the shadow.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { C } from "../../constants/colors";
import { motion, radius, shadow, text } from "../../constants/ui";
import { useDevFlag } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import { IconButton } from "./IconButton";
import { dur, ease, spr, useMotionReduced } from "./motion/presets";
import { registerToastLayer, ToastLayer } from "./Toast";

// ─── Public types ─────────────────────────────────────────────────────────────

export type BottomSheetProps = {
  visible: boolean;
  /** User intent to close (scrim tap, grabber/header/body pan past the threshold, Android back, header close). Set `visible` false in response. */
  onClose: () => void;
  /** Fires AFTER the native Modal has dismissed (iOS Modal.onDismiss; Android one frame after the exit animation + unmount) — `router.push` here (landmine 5 / C42). */
  onDismiss?: () => void;
  /** Header row (rendered when `title` or `showClose`): title 18/800 `text.screenTitle` left + close IconButton right. */
  title?: string;
  /** Shows the `close` IconButton (bg transparent, label "Close", silent). Default false. */
  showClose?: boolean;
  /** Panel max height. Default '85%' of the Modal. Content taller than this must scroll inside (the caller's ScrollView). */
  maxHeight?: number | `${number}%`;
  /** Fixed panel height in px (PIN sheet 320). Overrides `maxHeight`; the body gets `flex: 1`. */
  snapHeight?: number;
  /** 36×4 r2 C.border grabber, 10 px from the top, 6 px above the content; widens to 44 while dragging. Default true. */
  grabber?: boolean;
  /** Default C.scrim (55% black); fades in over motion.duration.base. */
  scrimColor?: string;
  /** Tapping the scrim calls `onClose`. Default true. */
  dismissOnScrim?: boolean;
  /** Android back (Modal.onRequestClose) calls `onClose`. Default true. */
  dismissOnBack?: boolean;
  /** Default false; true wraps scrim + panel in a KeyboardAvoidingView (behavior "padding"). */
  keyboardAvoiding?: boolean;
  /** Body wrapper style. Default `paddingHorizontal: 20`; `paddingBottom: max(insets.bottom, 12) + 12` is always applied. */
  contentStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  testID?: string;
};

// ─── Module constants ─────────────────────────────────────────────────────────

const GRABBER_WIDTH = 36;
const GRABBER_WIDTH_DRAGGING = 44;
const GRABBER_HEIGHT = 4;
/** Gap between the panel top and the sheet's own ToastLayer (px). */
const TOAST_GAP = 12;
/** Extra pan reach above/below the grabber strip so a 20 px handle is easy to grab. */
const HANDLE_HIT_SLOP = { top: 8, bottom: 12 } as const;
/** Header pan: claims the touch after 6 px vertical travel; gives up after 24 px horizontal travel. */
const HEADER_PAN_ACTIVE = 6;
const HEADER_PAN_FAIL_X = 24;
/** Body pan (manual activation): activates after 12 px downward travel with |dx| < dy; fails on 6 px upward or 16 px sideways. */
const BODY_PAN_ACTIVATE = 12;
const BODY_PAN_FAIL_UP = 6;
const BODY_PAN_FAIL_X = 16;
const DEFAULT_MAX_HEIGHT: `${number}%` = "85%";

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Open: scrim opacity 0 → 1 `withTiming(dur(base))`, panel translateY measuredHeight → 0 `withSpring(spr(gentle))`,
 * `feedback.swoosh()` once. Close: `withTiming(dur(base), ease.accel)` to the measured height, then the Modal closes
 * and `onDismiss` fires. Reduced motion: 120 ms fades instead of travel. Pan on the grabber + header row; also on the
 * body while the content is NOT clamped at `maxHeight` (a clamped body is assumed to scroll — see the deviation note in
 * the report); rubber-bands upward (−√dy·2), dismisses past `motion.sheetDismiss.fraction` (30 %) of the height or
 * velocity > `motion.sheetDismiss.velocity`, springs back otherwise; `feedback.select()` once per threshold crossing.
 * Dev_Altair_inhibit_PanDismiss → no pan. Dev_Altair_inhibit_Feature → plain `animationType="slide"` Modal, no pan.
 */
export function BottomSheet({
  visible,
  onClose,
  onDismiss,
  title,
  showClose = false,
  maxHeight = DEFAULT_MAX_HEIGHT,
  snapHeight,
  grabber = true,
  scrimColor = C.scrim,
  dismissOnScrim = true,
  dismissOnBack = true,
  keyboardAvoiding = false,
  contentStyle,
  children,
  testID,
}: BottomSheetProps): React.JSX.Element {
  const plain = useDevFlag("Dev_Altair_inhibit_Feature");
  const panInhibited = useDevFlag("Dev_Altair_inhibit_PanDismiss");
  const reduced = useMotionReduced();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  // `mounted` is state: it flips true with `visible` (derived during render) and false only after the exit animation.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  const [panelHeight, setPanelHeight] = useState(0);
  const [rootHeight, setRootHeight] = useState(0);

  // Plain mode lets the native slide do the work, so the panel starts in place and the scrim starts opaque.
  const ty = useSharedValue(plain ? 0 : windowHeight);
  const scrimOpacity = useSharedValue(plain ? 1 : 0);
  const panelOpacity = useSharedValue(1);
  const grabberWidth = useSharedValue(GRABBER_WIDTH);
  const crossed = useSharedValue(false);
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);

  const openedRef = useRef(false);
  const closingRef = useRef(false);
  const wasMountedRef = useRef(mounted);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  // ── Overlay toast layer: held for exactly as long as the Modal is mounted ──
  useEffect(() => {
    if (!mounted) return;
    return registerToastLayer();
  }, [mounted]);

  // ── Open / close motion ──
  useEffect(() => {
    if (!mounted) return;

    if (visible) {
      if (panelHeight <= 0 || openedRef.current) return;
      openedRef.current = true;
      closingRef.current = false;
      if (plain) {
        ty.set(0);
        panelOpacity.set(1);
        scrimOpacity.set(1);
      } else if (reduced) {
        ty.set(0);
        panelOpacity.set(0);
        panelOpacity.set(withTiming(1, { duration: dur(motion.duration.fast) }));
        scrimOpacity.set(withTiming(1, { duration: dur(motion.duration.fast) }));
      } else {
        panelOpacity.set(1);
        ty.set(panelHeight);
        ty.set(withSpring(0, spr(motion.spring.gentle)));
        scrimOpacity.set(withTiming(1, { duration: dur(motion.duration.base) }));
      }
      feedback.swoosh();
      return;
    }

    if (closingRef.current) return;
    closingRef.current = true;
    openedRef.current = false;
    const finish = () => {
      closingRef.current = false;
      // Park the panel off-screen (or in place for plain mode) so the next open's first frame is never a partial panel.
      ty.set(plain ? 0 : windowHeight);
      scrimOpacity.set(plain ? 1 : 0);
      setMounted(false);
    };
    if (plain) {
      finish();
      return;
    }
    const duration = dur(reduced ? motion.duration.fast : motion.duration.base);
    scrimOpacity.set(withTiming(0, { duration }));
    if (reduced) {
      panelOpacity.set(
        withTiming(0, { duration }, (finished) => {
          if (finished) scheduleOnRN(finish);
        }),
      );
    } else {
      ty.set(
        withTiming(panelHeight > 0 ? panelHeight : windowHeight, { duration, easing: ease.accel }, (finished) => {
          if (finished) scheduleOnRN(finish);
        }),
      );
    }
  }, [visible, mounted, panelHeight, plain, reduced, windowHeight, ty, scrimOpacity, panelOpacity]);

  // ── onDismiss, Android/web path: the Modal has no onDismiss there, so fire one frame after it unmounted ──
  useEffect(() => {
    const was = wasMountedRef.current;
    wasMountedRef.current = mounted;
    if (was && !mounted && Platform.OS !== "ios") {
      requestAnimationFrame(() => onDismissRef.current?.());
    }
  }, [mounted]);

  const handleNativeDismiss = () => onDismissRef.current?.();
  const handleRequestClose = () => {
    if (dismissOnBack) onClose();
  };
  const onPanelLayout = (e: LayoutChangeEvent) => setPanelHeight(Math.round(e.nativeEvent.layout.height));
  const onRootLayout = (e: LayoutChangeEvent) => setRootHeight(Math.round(e.nativeEvent.layout.height));

  // ── Pan ──
  const panEnabled = !plain && !panInhibited;
  const maxPx = typeof maxHeight === "number" ? maxHeight : rootHeight > 0 ? (rootHeight * parseFloat(maxHeight)) / 100 : 0;
  const clamped = snapHeight === undefined && maxPx > 0 && panelHeight >= maxPx - 1;
  const bodyPanEnabled = panEnabled && !clamped;

  const fraction = motion.sheetDismiss.fraction;
  const velocity = motion.sheetDismiss.velocity;
  const gentle = spr(motion.spring.gentle);
  const fastMs = dur(motion.duration.fast);
  const onCross = () => feedback.select();
  const requestClose = () => onClose();

  const dragStart = () => {
    "worklet";
    grabberWidth.set(withTiming(GRABBER_WIDTH_DRAGGING, { duration: fastMs }));
  };
  const dragTo = (dy: number) => {
    "worklet";
    ty.set(dy >= 0 ? dy : -Math.sqrt(-dy) * 2);
    const past = panelHeight > 0 && dy > panelHeight * fraction;
    if (past !== crossed.get()) {
      crossed.set(past);
      if (past) scheduleOnRN(onCross);
    }
  };
  const dragRelease = (dy: number, vy: number) => {
    "worklet";
    const dismiss = (panelHeight > 0 && dy > panelHeight * fraction) || vy > velocity;
    if (dismiss) scheduleOnRN(requestClose);
    else ty.set(withSpring(0, gentle));
  };
  const dragFinalize = () => {
    "worklet";
    crossed.set(false);
    grabberWidth.set(withTiming(GRABBER_WIDTH, { duration: fastMs }));
  };

  const headerPan = Gesture.Pan()
    .enabled(panEnabled)
    .hitSlop(HANDLE_HIT_SLOP)
    .activeOffsetY([-HEADER_PAN_ACTIVE, HEADER_PAN_ACTIVE])
    .failOffsetX([-HEADER_PAN_FAIL_X, HEADER_PAN_FAIL_X])
    .onStart(() => {
      "worklet";
      dragStart();
    })
    .onUpdate((e) => {
      "worklet";
      dragTo(e.translationY);
    })
    .onEnd((e) => {
      "worklet";
      dragRelease(e.translationY, e.velocityY);
    })
    .onFinalize(() => {
      "worklet";
      dragFinalize();
    });

  const bodyPan = Gesture.Pan()
    .enabled(bodyPanEnabled)
    .manualActivation(true)
    .onTouchesDown((e) => {
      "worklet";
      const touch = e.allTouches[0];
      if (!touch) return;
      touchStartX.set(touch.x);
      touchStartY.set(touch.y);
    })
    .onTouchesMove((e, state) => {
      "worklet";
      const touch = e.allTouches[0];
      if (!touch) return;
      const dx = touch.x - touchStartX.get();
      const dy = touch.y - touchStartY.get();
      if (dy < -BODY_PAN_FAIL_UP || Math.abs(dx) > BODY_PAN_FAIL_X) state.fail();
      else if (dy > BODY_PAN_ACTIVATE && Math.abs(dx) < dy) state.activate();
    })
    .onStart(() => {
      "worklet";
      dragStart();
    })
    .onUpdate((e) => {
      "worklet";
      dragTo(e.translationY);
    })
    .onEnd((e) => {
      "worklet";
      dragRelease(e.translationY, e.velocityY);
    })
    .onFinalize(() => {
      "worklet";
      dragFinalize();
    });

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrimOpacity.get() }));
  const panelStyle = useAnimatedStyle(() => ({ opacity: panelOpacity.get(), transform: [{ translateY: ty.get() }] }));
  const grabberStyle = useAnimatedStyle(() => ({ width: grabberWidth.get() }));

  const hasHeader = Boolean(title) || showClose;
  const paddingBottom = Math.max(insets.bottom, 12) + 12;
  const toastBottom = (panelHeight > 0 ? panelHeight : insets.bottom) + TOAST_GAP;

  const content = (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: scrimColor }, scrimStyle]}>
        <Pressable
          style={styles.flex}
          onPress={dismissOnScrim ? onClose : undefined}
          accessible={dismissOnScrim}
          accessibilityRole="button"
          accessibilityLabel="Close"
          testID={testID ? `${testID}-scrim` : undefined}
        />
      </Animated.View>

      <Animated.View
        style={[styles.panelOuter, snapHeight !== undefined ? { height: snapHeight } : { maxHeight }, panelStyle]}
        onLayout={onPanelLayout}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
        testID={testID ? `${testID}-panel` : undefined}
      >
        <View style={[styles.panelClip, snapHeight !== undefined && styles.flex]}>
          <GestureDetector gesture={headerPan}>
            <View>
              {grabber ? (
                <Animated.View
                  style={[styles.grabber, grabberStyle]}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              ) : (
                <View style={styles.grabberSpacer} />
              )}
              {hasHeader ? (
                <View style={styles.header}>
                  {title ? (
                    <Text style={styles.title} numberOfLines={1} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
                      {title}
                    </Text>
                  ) : (
                    <View style={styles.flex} />
                  )}
                  {showClose ? <IconButton icon="close" bg="transparent" accessibilityLabel="Close" onPress={onClose} /> : null}
                </View>
              ) : null}
            </View>
          </GestureDetector>
          <GestureDetector gesture={bodyPan}>
            <View style={[styles.body, snapHeight !== undefined && styles.flex, { paddingBottom }, contentStyle]}>{children}</View>
          </GestureDetector>
        </View>
      </Animated.View>
    </>
  );

  return (
    <Modal
      visible={mounted}
      transparent
      statusBarTranslucent
      animationType={plain ? "slide" : "none"}
      onRequestClose={handleRequestClose}
      onDismiss={Platform.OS === "ios" ? handleNativeDismiss : undefined}
      testID={testID}
    >
      <GestureHandlerRootView style={styles.flex}>
        {/* The ToastLayer sits INSIDE the avoiding view so a raised keyboard lifts the toasts with the panel (W3 R3-18). */}
        {keyboardAvoiding ? (
          <KeyboardAvoidingView style={styles.root} behavior="padding" onLayout={onRootLayout}>
            {content}
            <ToastLayer bottomOffset={toastBottom} testID={testID ? `${testID}-toasts` : undefined} />
          </KeyboardAvoidingView>
        ) : (
          <View style={styles.root} onLayout={onRootLayout}>
            {content}
            <ToastLayer bottomOffset={toastBottom} testID={testID ? `${testID}-toasts` : undefined} />
          </View>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

/** Convenience `{ visible, open, close }` state for a sheet. `initial` default false. */
export function useBottomSheetState(initial = false): { visible: boolean; open: () => void; close: () => void } {
  const [visible, setVisible] = useState(initial);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  return { visible, open, close };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, justifyContent: "flex-end" },
  // OUTER: background + radius + shadow.sheet (elevation 20), no overflow clipping (MAP §7.4).
  panelOuter: {
    backgroundColor: C.card,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    ...shadow.sheet,
  },
  // INNER: clips the top corners so content (images, bands) respects the radius.
  panelClip: {
    flexShrink: 1,
    backgroundColor: C.card,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    overflow: "hidden",
  },
  grabber: {
    alignSelf: "center",
    width: GRABBER_WIDTH,
    height: GRABBER_HEIGHT,
    borderRadius: GRABBER_HEIGHT / 2,
    backgroundColor: C.border,
    marginTop: 10,
    marginBottom: 6,
  },
  grabberSpacer: { height: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10 },
  title: { ...text.screenTitle, flex: 1 },
  body: { flexShrink: 1, paddingHorizontal: 20 },
});
