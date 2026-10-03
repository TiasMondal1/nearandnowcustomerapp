// codename: indigo
// Key/value row for the dev panel (CONTRACTS §5) plus the small private kit every other `components/dev/*` file shares:
// the D11 Q1 monospace face (allowed ONLY under components/dev for flag names and values), the copy-to-clipboard helper,
// the value chip, the section eyebrow, and `DevPills` — the ONE sanctioned private control in components/dev
// (CONTRACTS §5 rev. 2: Chip fills brand green when selected and SegmentedControl cannot wrap or change its tint, and an
// internal tool must never look like a brand surface). Nothing in this file imports another dev file, so it is cycle-free.
import * as Clipboard from "expo-clipboard";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { fontFamily, motion, radius, text } from "../../constants/ui";
import { feedback } from "../../lib/feedback";
import { logSilentFailure } from "../../lib/logSilentFailure";
import { PressableScale, notify } from "../ui";

// ─── Shared dev-panel kit (optional extras beyond CONTRACTS §5) ───────────────

/** D11 Q1: monospace is allowed only under `components/dev/*`, for flag names and values. Everything else stays Jakarta. */
export const DEV_MONO_FAMILY: string = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) ?? "monospace";

/** Value text presets — `text.code` / `text.codeSm` (12 / 11 px, tabular-nums) with the face swapped to the D11 Q1 mono. */
export const devText = StyleSheet.create({
  /** `text.code` metrics (12 px, C.text, tabular nums, letterSpacing 0.2) in mono — flag names, values, version. */
  code: { ...text.code, fontFamily: DEV_MONO_FAMILY, lineHeight: 16 },
  /** `text.codeSm` metrics (11 px, C.textSub) in mono — network log lines, storage previews. */
  codeSm: { ...text.codeSm, fontFamily: DEV_MONO_FAMILY, lineHeight: 15 },
  /** 11/500 Jakarta C.textSub — captions under controls (same metrics as the shared `text.caption`, kept local so the panel never follows a retune). */
  caption: { fontFamily: fontFamily.medium, fontSize: 11, lineHeight: 14, color: C.textSub },
});

/** Long-press copy target: 44 pt tall rows are already fine; chips are ~24 pt, so lift them. */
const CHIP_HIT_SLOP = { top: 10, bottom: 10, left: 6, right: 6 } as const;

/**
 * Copies `value` and shows the "Copied" toast (silent — toasts never play sounds). Never throws; a clipboard failure
 * (web without permission, odd runtimes) is logged via `logSilentFailure` and surfaces as an error toast.
 */
export function copyText(value: string, title = "Copied"): void {
  Clipboard.setStringAsync(value)
    .then(() => {
      notify({ id: "dev-copied", title, tone: "neutral", duration: 1600, haptic: false });
    })
    .catch((err) => {
      logSilentFailure("DevPanel.copy", err);
      notify({ id: "dev-copied", title: "Could not copy", tone: "error" });
    });
}

/** `null`/`undefined` → "—", booleans → "yes"/"no", everything else `String()`. */
export function formatDevValue(value: DevKeyValueProps["value"]): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

export type ValueChipProps = {
  /** Text shown inside the chip (already formatted). */
  value: string;
  /** Default true: mono `devText.code`; false: Jakarta 12/500 (prose values such as labels). */
  mono?: boolean;
  /** Draws the chip C.dangerLight with C.danger text (e.g. "PIN source: default" on a production build). */
  danger?: boolean;
  /** Default: copies `value` (tap and long-press both copy — design §4.4 "tap value to copy", card "long-press → copy"). */
  onPress?: () => void;
  /** Default: same as onPress. */
  onLongPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
  testID?: string;
};

/**
 * `C.bgSoft` r6 chip (ph8 pv4) holding a selectable value; tap or long-press copies it to the clipboard with a
 * "Copied" toast. `danger` swaps the pair to C.dangerLight / C.danger.
 */
export function ValueChip({
  value,
  mono = true,
  danger = false,
  onPress,
  onLongPress,
  accessibilityLabel,
  style,
  textStyle,
  numberOfLines = 1,
  testID,
}: ValueChipProps): React.JSX.Element {
  const copy = () => copyText(value);
  return (
    <Pressable
      onPress={onPress ?? copy}
      onLongPress={onLongPress ?? onPress ?? copy}
      delayLongPress={400}
      hitSlop={CHIP_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? value}
      accessibilityHint="Copies the value"
      style={({ pressed }) => [styles.chip, danger && styles.chipDanger, pressed && styles.chipPressed, style]}
      testID={testID}
    >
      <Text
        selectable
        numberOfLines={numberOfLines}
        maxFontSizeMultiplier={1.3}
        style={[mono ? devText.code : styles.chipProse, danger && styles.chipDangerText, textStyle]}
      >
        {value}
      </Text>
    </Pressable>
  );
}

/** Eyebrow section title (`text.eyebrow`, uppercase 11/700 C.textSub) with 16 px above and 8 px below. */
export function DevSectionTitle({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }): React.JSX.Element {
  return (
    <Text style={[styles.sectionTitle, style]} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
      {children}
    </Text>
  );
}

export type DevPillItem<K extends string> = { key: K; label: string; accessibilityLabel?: string };

export type DevPillsProps<K extends string> = {
  items: readonly DevPillItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** "tablist" (panel tab strip, default) renders `tab` roles; "radiogroup" (enum / preset values) renders `radio` roles. */
  role?: "tablist" | "radiogroup";
  /** Default "select": `feedback.select()` on change (lead Q2 — a tab switch is a haptic only, never a sound). "none" lets the caller play its own (flag rows play `feedback.toggle`). */
  feedback?: "select" | "none";
  /** md (default): minHeight 32, ph12, 12/600 · sm: minHeight 28, ph10, 11/600. */
  size?: "md" | "sm";
  /** Default false (single row, horizontally scrollable by the parent); true wraps onto several lines. */
  wrap?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * The one sanctioned private control in `components/dev` (CONTRACTS §5 rev. 2): a row of pills whose SELECTED pill fills
 * `C.text` with `C.white` text and whose idle pills are `C.bgSoft` / `C.textSub` — never brand green, so a developer can
 * tell the tool from the product at a glance. `PressableScale` (scale `motion.scale.chip`), gap 6, r999. Re-selecting the
 * current pill does nothing (no feedback, no onChange).
 */
export function DevPills<K extends string>({
  items,
  value,
  onChange,
  role = "tablist",
  feedback: fb = "select",
  size = "md",
  wrap = false,
  accessibilityLabel,
  style,
  testID,
}: DevPillsProps<K>): React.JSX.Element {
  const itemRole = role === "tablist" ? "tab" : "radio";
  return (
    <View style={[styles.pills, wrap && styles.pillsWrap, style]} accessibilityRole={role} accessibilityLabel={accessibilityLabel} testID={testID}>
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <PressableScale
            key={item.key}
            scale={motion.scale.chip}
            haptic={false}
            onPress={() => {
              if (selected) return;
              if (fb === "select") feedback.select();
              onChange(item.key);
            }}
            accessibilityRole={itemRole}
            accessibilityLabel={item.accessibilityLabel ?? item.label}
            accessibilityState={{ selected, checked: role === "radiogroup" ? selected : undefined }}
            style={styles.pillOuter}
            innerStyle={[styles.pill, size === "sm" && styles.pillSm, selected && styles.pillSelected]}
            pressedStyle={selected ? undefined : styles.pillPressed}
          >
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
              style={[styles.pillText, size === "sm" && styles.pillTextSm, selected && styles.pillTextSelected]}
            >
              {item.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

// ─── DevKeyValue (CONTRACTS §5) ───────────────────────────────────────────────

export type DevKeyValueProps = {
  /** Left column, `text.label` (12/600 C.textSub). */
  label: string;
  /** Right column; `null`/`undefined` render "—", booleans "yes"/"no". */
  value: string | number | boolean | null | undefined;
  /** Default true: value in the mono `devText.code` face. */
  mono?: boolean;
  /** Value chip in C.dangerLight / C.danger (e.g. default PIN on a production profile). */
  danger?: boolean;
  /** Optional second line under the label, `devText.caption`. */
  hint?: string;
  testID?: string;
};

/**
 * Two-column row (minHeight 40, 1 px `C.border` hairline below): label left, `ValueChip` right (max 60 % width,
 * 2 lines). Tap or long-press on the value copies it and toasts "Copied". Everything is readable by screen readers as
 * "<label>: <value>".
 */
export function DevKeyValue({ label, value, mono = true, danger = false, hint, testID }: DevKeyValueProps): React.JSX.Element {
  const formatted = formatDevValue(value);
  return (
    <View style={styles.row} testID={testID}>
      <View style={styles.rowLabelWrap}>
        <Text style={styles.rowLabel} numberOfLines={2} maxFontSizeMultiplier={1.3}>
          {label}
        </Text>
        {hint ? (
          <Text style={devText.caption} numberOfLines={2} maxFontSizeMultiplier={1.3}>
            {hint}
          </Text>
        ) : null}
      </View>
      <ValueChip
        value={formatted}
        mono={mono}
        danger={danger}
        numberOfLines={2}
        accessibilityLabel={`${label}: ${formatted}`}
        style={styles.rowValue}
        textStyle={styles.rowValueText}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: C.bgSoft,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  chipPressed: { backgroundColor: C.border },
  chipDanger: { backgroundColor: C.dangerLight },
  chipDangerText: { color: C.danger },
  chipProse: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16, color: C.text },
  sectionTitle: { ...text.eyebrow, marginTop: 16, marginBottom: 8 },
  pills: { flexDirection: "row", gap: 6 },
  pillsWrap: { flexWrap: "wrap" },
  pillOuter: { flexShrink: 1 },
  pill: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  pillSm: { minHeight: 28, paddingHorizontal: 10 },
  pillSelected: { backgroundColor: C.text },
  pillPressed: { backgroundColor: C.border },
  pillText: { fontFamily: fontFamily.semibold, fontSize: 12, lineHeight: 16, color: C.textSub },
  pillTextSm: { fontSize: 11, lineHeight: 14 },
  pillTextSelected: { color: C.white },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 40,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  rowLabelWrap: { flex: 1, gap: 2 },
  rowLabel: { ...text.label },
  rowValue: { maxWidth: "60%", alignSelf: "center" },
  rowValueText: { textAlign: "right" },
});
