// AnimatedNumber — animated numeric text (codename onyx). Three renderers behind one prop API:
//   'count' — ticker: a shared value drives the `text` prop of a non-editable TextInput through useAnimatedProps,
//             so every frame is formatted on the UI thread and React never re-renders per frame;
//   'roll'  — odometer: every digit is a 0–9 strip clipped to one line height and sprung to the new digit;
//   'fade'  — crossfade of the whole string (letters in the text such as "0.25 kg", or nothing to count).
// Reduced motion and `duration={0}` snap every renderer (CONTRACTS §4.3 rev. 2 — wallet seeds its balance with 0).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { PixelRatio, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle } from "react-native";
import Animated, { cancelAnimation, useAnimatedProps, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

import { motion } from "../../../constants/ui";
import { dur, ease, enter, exit, layoutSpring, spr, useLayoutTransitionsEnabled, useMotionReduced } from "./presets";

export type AnimatedNumberProps = {
  /** The number to show. A change animates from the value currently displayed. */
  value: number;
  /** Formats the FINAL value; for 'count' it also defines the prefix / suffix / decimals / digit grouping reproduced on every frame. Default `String`. */
  format?: (n: number) => string;
  /**
   * 'count' = ticker · 'roll' = per-digit odometer (non-digit characters stay static) · 'auto' (default) = roll for
   * integers with |value| < 10000, count for other numbers, crossfade when the text contains letters.
   */
  mode?: "count" | "roll" | "auto";
  /**
   * 'count' tween length in ms (× speed factor). Default `motion.duration.countUp` (900). **`0` snaps every mode**
   * (snap-then-animate: pass `armed ? motion.duration.countUp : 0`). 'roll' springs on `motion.spring.snappy` and
   * only honours 0.
   */
  duration?: number;
  /** Text style. In 'roll' its `lineHeight` (else `fontSize × 1.3`, default 14 → 18 px) is the strip row height. Tabular figures are forced in 'count' and 'roll'. */
  style?: StyleProp<TextStyle>;
  /** Read by assistive tech instead of the strips / ticker. Default: the formatted final value. */
  accessibilityLabel?: string;
  testID?: string;
};

// ─── Shape of the formatted value (what the UI-thread formatter reproduces per frame) ─────────────────────────

type Grouping = "none" | "west" | "indian";
type Shape = { prefix: string; suffix: string; decimals: number; grouping: Grouping; target: number; targetText: string };

const HAS_LETTER = /[A-Za-z]/;
const HAS_DIGIT = /\d/;
/** 'auto' rolls integers below this and counts the rest. */
const ROLL_MAX = 10000;
/** Strip row height when the style has no lineHeight: fontSize × this. */
const LINE_HEIGHT_RATIO = 1.3;

/** Split `text` (= format(value)) into prefix + ONE numeric run + suffix; null when there is not exactly one run. */
function parseShape(text: string, value: number): Shape | null {
  const runs = text.match(/-?\d[\d,]*(?:\.\d+)?/g);
  if (!runs || runs.length !== 1) return null;
  const run = runs[0];
  const start = text.indexOf(run);
  const body = run.startsWith("-") ? run.slice(1) : run;
  const dot = body.indexOf(".");
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const decimals = dot === -1 ? 0 : body.length - dot - 1;
  const groups = intPart.split(",");
  let grouping: Grouping = "none";
  if (groups.length > 1) grouping = groups.slice(1, -1).some((g) => g.length === 2) ? "indian" : "west";
  return { prefix: text.slice(0, start), suffix: text.slice(start + run.length), decimals, grouping, target: value, targetText: text };
}

/** UI-thread formatter for intermediate frames; returns the caller's exact text at the target. */
function formatShaped(n: number, s: Shape): string {
  "worklet";
  if (n === s.target) return s.targetText;
  const negative = n < 0;
  const fixed = Math.abs(n).toFixed(s.decimals);
  const dot = fixed.indexOf(".");
  const intPart = dot === -1 ? fixed : fixed.slice(0, dot);
  const frac = dot === -1 ? "" : fixed.slice(dot);
  let grouped = intPart;
  if (s.grouping !== "none" && intPart.length > 3) {
    const head = intPart.slice(0, -3);
    const tail = intPart.slice(-3);
    const size = s.grouping === "west" ? 3 : 2;
    let out = "";
    for (let i = head.length; i > 0; i -= size) {
      const chunk = head.slice(Math.max(0, i - size), i);
      out = out ? chunk + "," + out : chunk;
    }
    grouped = out + "," + tail;
  }
  return s.prefix + (negative ? "-" : "") + grouped + frac + s.suffix;
}

type Renderer = "count" | "roll" | "fade";

function resolveRenderer(mode: NonNullable<AnimatedNumberProps["mode"]>, value: number, text: string, shape: Shape | null): Renderer {
  if (mode === "roll") return HAS_DIGIT.test(text) ? "roll" : "fade";
  if (mode === "count") return shape ? "count" : "fade";
  if (!shape || HAS_LETTER.test(text)) return "fade";
  if (Number.isInteger(value) && Math.abs(value) < ROLL_MAX && shape.decimals === 0) return "roll";
  return "count";
}

function resolveLineHeight(style: StyleProp<TextStyle>): number {
  const flat = StyleSheet.flatten(style);
  if (flat?.lineHeight) return flat.lineHeight;
  return Math.round((flat?.fontSize ?? 14) * LINE_HEIGHT_RATIO);
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Block-level animated number (not for nesting inside `<Text>`). Exposes `accessibilityLabel` (default: the
 * formatted final value) on one `accessibilityRole="text"` element; the strips / ticker are hidden from assistive
 * tech. Snaps (no intermediate frame) under reduced motion, the Onyx inhibit flags and `duration={0}`.
 */
export function AnimatedNumber({
  value,
  format = String,
  mode = "auto",
  duration = motion.duration.countUp,
  style,
  accessibilityLabel,
  testID,
}: AnimatedNumberProps): React.JSX.Element {
  const reduced = useMotionReduced();
  const text = format(value);
  const shape = useMemo(() => parseShape(text, value), [text, value]);
  const renderer = resolveRenderer(mode, value, text, shape);
  const snap = reduced || duration <= 0;
  const label = accessibilityLabel ?? text;

  if (renderer === "count" && shape) {
    return <CountText shape={shape} duration={duration} snap={snap} style={style} label={label} testID={testID} />;
  }
  if (renderer === "roll") {
    return <RollText text={text} snap={snap} style={style} label={label} testID={testID} />;
  }
  return <FadeText text={text} snap={snap} style={style} label={label} testID={testID} />;
}

type RendererProps = { snap: boolean; style: StyleProp<TextStyle>; label: string; testID?: string };

// ─── 'count' ──────────────────────────────────────────────────────────────────

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

function CountText({ shape, duration, snap, style, label, testID }: RendererProps & { shape: Shape; duration: number }) {
  const current = useSharedValue(shape.target);
  const shapeValue = useSharedValue(shape);
  // The React-committed text never changes after mount; reanimated owns the native text from here on.
  const [initialText] = useState(shape.targetText);

  useEffect(() => {
    shapeValue.set(shape);
    if (snap) {
      cancelAnimation(current);
      current.set(shape.target);
      return;
    }
    current.set(withTiming(shape.target, { duration: dur(duration), easing: ease.decel }));
  }, [shape, snap, duration, current, shapeValue]);

  const animatedProps = useAnimatedProps<TextInputProps & { text: string }>(() => ({
    text: formatShaped(current.get(), shapeValue.get()),
  }));

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={label} testID={testID}>
      {/* Invisible sizer: the box is always as wide as the FINAL text, so the ticker never reflows mid-count. */}
      <Text style={[style, styles.tabular, styles.sizer]} numberOfLines={1} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {shape.targetText}
      </Text>
      <AnimatedTextInput
        animatedProps={animatedProps}
        defaultValue={initialText}
        editable={false}
        caretHidden
        contextMenuHidden
        scrollEnabled={false}
        underlineColorAndroid="transparent"
        pointerEvents="none"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[StyleSheet.absoluteFill, styles.input, style, styles.tabular]}
      />
    </View>
  );
}

// ─── 'roll' ───────────────────────────────────────────────────────────────────

/** 0–9 plus a trailing 0 so 9 → 0 can roll UP through index 10 (then snap to 0 while both glyphs read "0"). */
const STRIP = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

type Cell = { key: string; char: string; digit: number | null };

/** Keys count from the RIGHT (ones place = d0) so existing columns keep their identity when a digit is added on the left. */
function tokenise(text: string): Cell[] {
  const chars = Array.from(text);
  const cells: Cell[] = [];
  let digits = 0;
  let statics = 0;
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const char = chars[i];
    if (char >= "0" && char <= "9") {
      cells.push({ key: `d${digits}`, char, digit: char.charCodeAt(0) - 48 });
      digits += 1;
    } else {
      cells.push({ key: `s${statics}${char}`, char, digit: null });
      statics += 1;
    }
  }
  return cells.reverse();
}

function RollText({ text, snap, style, label, testID }: RendererProps & { text: string }) {
  const layoutEnabled = useLayoutTransitionsEnabled();
  const [initialText] = useState(text);
  // Columns present at mount never fade in (recycled list cells, first paint); only columns added later do.
  const animateColumns = !snap && text !== initialText;
  const lineHeight = resolveLineHeight(style);
  // RN scales `lineHeight` with the font scale; the clipping views must match.
  const rowHeight = lineHeight * PixelRatio.getFontScale();
  const glyphStyle: StyleProp<TextStyle> = [style, styles.tabular, { lineHeight, height: rowHeight }, styles.glyph];
  const cells = tokenise(text);

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={label} testID={testID} style={styles.row}>
      <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {cells.map((cell) =>
          cell.digit === null ? (
            <Animated.Text
              key={cell.key}
              style={glyphStyle}
              layout={layoutEnabled && !snap ? layoutSpring() : undefined}
              entering={animateColumns ? enter.fade() : undefined}
              exiting={snap ? undefined : exit.fade()}
            >
              {cell.char}
            </Animated.Text>
          ) : (
            <RollDigit
              key={cell.key}
              digit={cell.digit}
              rowHeight={rowHeight}
              glyphStyle={glyphStyle}
              snap={snap}
              animateMount={animateColumns}
              layoutEnabled={layoutEnabled && !snap}
            />
          ),
        )}
      </View>
    </View>
  );
}

function RollDigit({
  digit,
  rowHeight,
  glyphStyle,
  snap,
  animateMount,
  layoutEnabled,
}: {
  digit: number;
  rowHeight: number;
  glyphStyle: StyleProp<TextStyle>;
  snap: boolean;
  animateMount: boolean;
  layoutEnabled: boolean;
}) {
  const position = useSharedValue(digit);
  const lastDigitRef = useRef(digit);

  useEffect(() => {
    const prev = lastDigitRef.current;
    if (prev === digit) return;
    lastDigitRef.current = digit;
    if (snap) {
      cancelAnimation(position);
      position.set(digit);
      return;
    }
    const config = spr(motion.spring.snappy);
    if (prev === 9 && digit === 0) {
      // Increment past 9: keep rolling upward into the trailing "0", then jump to the real 0 (same glyph).
      position.set(
        withSpring(10, config, (finished) => {
          "worklet";
          if (finished) position.set(0);
        }),
      );
      return;
    }
    if (prev === 0 && digit === 9) {
      // Decrement below 0: start from the trailing "0" so the strip rolls downward one row.
      position.set(10);
      position.set(withSpring(9, config));
      return;
    }
    position.set(withSpring(digit, config));
  }, [digit, snap, position]);

  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -position.get() * rowHeight }] }));

  return (
    <Animated.View
      style={[styles.digitClip, { height: rowHeight }]}
      layout={layoutEnabled ? layoutSpring() : undefined}
      entering={animateMount ? enter.fade() : undefined}
      exiting={snap ? undefined : exit.fade()}
    >
      <Animated.View style={stripStyle}>
        {STRIP.map((glyph, i) => (
          <Text key={i} style={glyphStyle}>
            {glyph}
          </Text>
        ))}
      </Animated.View>
    </Animated.View>
  );
}

// ─── 'fade' ───────────────────────────────────────────────────────────────────

function FadeText({ text, snap, style, label, testID }: RendererProps & { text: string }) {
  const [initialText] = useState(text);
  const animate = !snap && text !== initialText;
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={label} testID={testID}>
      <Animated.Text
        key={text}
        style={style}
        entering={animate ? enter.fade() : undefined}
        exiting={snap ? undefined : exit.fade()}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {text}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  // Clips ONLY the digit strip — never an elevated parent (MAP §7.4).
  digitClip: { overflow: "hidden" },
  glyph: { includeFontPadding: false, textAlignVertical: "center" },
  tabular: { fontVariant: ["tabular-nums"] },
  sizer: { opacity: 0 },
  input: { padding: 0, margin: 0, includeFontPadding: false, textAlignVertical: "center" },
});
