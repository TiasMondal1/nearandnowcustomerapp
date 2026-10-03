// Confetti — 24 reanimated rects on ONE shared progress (order confirmation, codename nova consumes it).
// Never intercepts touches, hidden from assistive tech, unmounts itself after 1600 ms (× speed factor) and
// calls `onDone`. Renders nothing under reduced motion. No deps beyond reanimated (motion doc C10).
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";

import { C } from "../../../constants/colors";
import { radius } from "../../../constants/ui";
import { dur, ease, useMotionReduced } from "./presets";

export type ConfettiProps = {
  /** Burst origin in the container's coordinates (px). Default: horizontal centre, 35 % from the top. */
  origin?: { x: number; y: number };
  /** Particle count. Default 24. */
  count?: number;
  /** Particle colours, cycled. Default `[C.primary, C.primaryLight, C.deal, C.warning, C.white]`. */
  colors?: string[];
  /** Called once, when the burst is over and the component has unmounted itself (1600 ms × speed factor; next tick under reduced motion). */
  onDone?: () => void;
  /** Container style, merged over `StyleSheet.absoluteFill`. The container never intercepts touches. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Flight of the shared progress 0 → 1, ms (× speed factor). */
const FLIGHT_MS = 1400;
/** Lifetime before self-unmount, ms (× speed factor). */
const LIFETIME_MS = 1600;
/** Extra fall at p = 1 in px (translateY += GRAVITY · p²). */
const GRAVITY = 420;
const DEFAULT_COUNT = 24;
const DEFAULT_COLORS = [C.primary, C.primaryLight, C.deal, C.warning, C.white];

type Particle = { angle: number; speed: number; spin: number; color: string; w: number; h: number; radius: number };

/** Static per-particle seed, created once per mount (`useState(() => seed())`) so re-renders never re-roll. */
function seedParticles(count: number, colors: string[]): Particle[] {
  const palette = colors.length > 0 ? colors : DEFAULT_COLORS;
  const out: Particle[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      // Fan upwards between −160° and −20° so the burst reads as a toss, not an explosion.
      angle: -Math.PI * (0.11 + Math.random() * 0.78),
      speed: 180 + Math.random() * 200,
      spin: (Math.random() - 0.5) * 1440,
      color: palette[i % palette.length],
      w: 6 + Math.round(Math.random() * 4),
      h: 10 + Math.round(Math.random() * 6),
      radius: i % 3 === 0 ? radius.pill : radius.xs,
    });
  }
  return out;
}

/**
 * One burst: `progress` runs `withTiming(1, { duration: dur(1400), easing: ease.decel })` once; each particle maps it to
 * translateX = cos(a)·v·p, translateY = sin(a)·v·p + 420·p², rotate = spin·p, opacity = 1 − p³. Returns an empty
 * fragment once done or under reduced motion.
 */
export function Confetti({ origin, count = DEFAULT_COUNT, colors, onDone, style, testID }: ConfettiProps): React.JSX.Element {
  const reduced = useMotionReduced();
  const [particles] = useState(() => seedParticles(count, colors ?? DEFAULT_COLORS));
  const [done, setDone] = useState(false);
  const progress = useSharedValue(0);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (reduced) {
      const t = setTimeout(() => {
        setDone(true);
        onDoneRef.current?.();
      }, 0);
      return () => clearTimeout(t);
    }
    progress.set(0);
    progress.set(withTiming(1, { duration: dur(FLIGHT_MS), easing: ease.decel }));
    const t = setTimeout(() => {
      setDone(true);
      onDoneRef.current?.();
    }, dur(LIFETIME_MS));
    return () => {
      clearTimeout(t);
      cancelAnimation(progress);
    };
  }, [reduced, progress]);

  if (done || reduced) return <></>;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, style]}
      testID={testID}
    >
      {particles.map((particle, i) => (
        <Piece key={i} particle={particle} progress={progress} origin={origin} />
      ))}
    </View>
  );
}

function Piece({ particle, progress, origin }: { particle: Particle; progress: SharedValue<number>; origin?: { x: number; y: number } }) {
  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.get();
    const d = particle.speed * p;
    return {
      opacity: 1 - p * p * p,
      transform: [
        { translateX: Math.cos(particle.angle) * d },
        { translateY: Math.sin(particle.angle) * d + GRAVITY * p * p },
        { rotate: `${particle.spin * p}deg` },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        styles.piece,
        origin ? { left: origin.x, top: origin.y } : styles.defaultOrigin,
        { width: particle.w, height: particle.h, borderRadius: particle.radius, backgroundColor: particle.color },
        animatedStyle,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  piece: { position: "absolute" },
  defaultOrigin: { left: "50%", top: "35%" },
});
