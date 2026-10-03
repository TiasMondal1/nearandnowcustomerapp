// codename: indigo
// One registry entry rendered by `type` (CONTRACTS §5, design §4.4): bool → Toggle; number → [−] value [+] with a
// tappable value (numeric keyboard, clamped by the store) and preset pills; enum → pills; string → underline Input +
// "Apply" (the registry `validate` regex rejects inline with `feedback.error()`). Every row prints its flag NAME verbatim
// (D1) as a copyable mono chip, carries a 3 px `C.warning` bar while it differs from its default, resets on long-press,
// and plays `feedback.toggle(on)` once per change (M28 — this is how a developer verifies the Sirius flags instantly).
import React, { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { C } from "../../constants/colors";
import { fontFamily, text } from "../../constants/ui";
import {
  DEV_FLAGS,
  resetDevFlag,
  setDevFlag,
  useDevFlag,
  type DevFlagDef,
  type DevFlagName,
  type DevFlagValue,
  type NumberFlagDef,
  type StringFlagDef,
} from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import { logSilentFailure } from "../../lib/logSilentFailure";
import { IconButton, Input, PrimaryButton, Toggle } from "../ui";
import { DevPills, ValueChip, devText } from "./DevKeyValue";

export type DevFlagRowProps = { name: DevFlagName };

// ─── Typed routing into the store (no casts: type guards narrow the name, the store validates at runtime) ───────────

type FlagPrimitive = boolean | number | string;

/** Flag names whose registry entry has `type: T`. */
type FlagNamesOf<T extends DevFlagDef["type"]> = {
  [K in DevFlagName]: (typeof DEV_FLAGS)[K] extends { type: T } ? K : never;
}[DevFlagName];
type BoolFlagName = FlagNamesOf<"bool">;
type NumberFlagName = FlagNamesOf<"number">;
type EnumFlagName = FlagNamesOf<"enum">;
type StringFlagName = FlagNamesOf<"string">;

function isBoolFlag(name: DevFlagName): name is BoolFlagName {
  return DEV_FLAGS[name].type === "bool";
}
function isNumberFlag(name: DevFlagName): name is NumberFlagName {
  return DEV_FLAGS[name].type === "number";
}
function isEnumFlag(name: DevFlagName): name is EnumFlagName {
  return DEV_FLAGS[name].type === "enum";
}
function isStringFlag(name: DevFlagName): name is StringFlagName {
  return DEV_FLAGS[name].type === "string";
}
function isEnumValue(name: EnumFlagName, v: string): v is DevFlagValue<EnumFlagName> {
  return DEV_FLAGS[name].values.some((x: string) => x === v);
}

/**
 * `useDevFlag` is typed per literal name; over the whole `DevFlagName` union its (non-distributive) conditional collapses
 * to `string`, and a `const raw: FlagPrimitive = …` would be narrowed back to `string` on assignment. Returning through a
 * function keeps the runtime truth — boolean | number | string — so the row can branch on `def.type`.
 */
function useFlagPrimitive(name: DevFlagName): FlagPrimitive {
  return useDevFlag(name);
}

/**
 * Optional extra: writes a runtime-typed value to a flag of any `type`. Rejects (never throws) with the same one-line
 * reasons `setDevFlag` uses, so callers can show them inline. Numbers are clamped by the store.
 */
export function setFlagValue(name: DevFlagName, next: FlagPrimitive): Promise<void> {
  if (isBoolFlag(name)) {
    return typeof next === "boolean" ? setDevFlag(name, next) : Promise.reject(new Error("Expected true or false"));
  }
  if (isNumberFlag(name)) {
    return typeof next === "number" && Number.isFinite(next) ? setDevFlag(name, next) : Promise.reject(new Error("Expected a number"));
  }
  if (isEnumFlag(name)) {
    return typeof next === "string" && isEnumValue(name, next)
      ? setDevFlag(name, next)
      : Promise.reject(new Error(`Expected one of ${DEV_FLAGS[name].values.join(", ")}`));
  }
  if (isStringFlag(name)) {
    return typeof next === "string" ? setDevFlag(name, next) : Promise.reject(new Error("Expected text"));
  }
  return Promise.reject(new Error("Unknown flag"));
}

// ─── Number formatting ────────────────────────────────────────────────────────

function decimalsOf(step: number): number {
  const s = String(step);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** Formats with the step's precision (0.1 → one decimal) so 0.1 + 0.2 never prints as 0.30000000000000004. */
export function formatFlagNumber(value: number, step = 1): string {
  const d = decimalsOf(step);
  return d > 0 ? value.toFixed(d) : String(Math.round(value));
}

function stepValue(value: number, step: number, direction: 1 | -1, def: NumberFlagDef): number {
  const next = Number((value + direction * step).toFixed(decimalsOf(step)));
  return Math.min(def.max, Math.max(def.min, next));
}

// ─── Row ──────────────────────────────────────────────────────────────────────

/** Long-press on the row body resets the flag; 500 ms matches the panel's other long-presses. */
const RESET_LONG_PRESS_MS = 500;
/** Width of the inline numeric editor (fits "100000" plus the clear glyph). */
const NUMBER_EDITOR_WIDTH = 96;

/**
 * Layout: 3 px marker · [label `text.rowTitle` / name chip `devText.code`, wrapping up to 3 lines so the longest names
 * stay verbatim beside a number control / help `text.rowSubtitle`] · control on the
 * right (bool, number) or under the text (enum pills, number presets, string input). Row tap on a bool flips it;
 * long-press anywhere on the text resets the flag (`feedback.toggle(false)`). Errors from the store render inline in
 * C.danger with `feedback.error()`; `restart: true` flags show "Restart to apply" once changed.
 */
export function DevFlagRow({ name }: DevFlagRowProps): React.JSX.Element {
  const def: DevFlagDef = DEV_FLAGS[name];
  const raw = useFlagPrimitive(name);
  const changed = raw !== def.default;
  const [error, setError] = useState<string | null>(null);

  const reportError = (message: string) => {
    setError(message);
    feedback.error();
  };

  /** Writes `next`; `on` (when given) is what `feedback.toggle` plays after the store accepted it. */
  const apply = (next: FlagPrimitive, on?: boolean) => {
    setError(null);
    setFlagValue(name, next)
      .then(() => {
        if (on !== undefined) feedback.toggle(on);
      })
      .catch((err: unknown) => reportError(err instanceof Error ? err.message : "Invalid value"));
  };

  const reset = () => {
    if (!changed) return;
    setError(null);
    resetDevFlag(name)
      .then(() => feedback.toggle(false))
      .catch((err) => logSilentFailure("DevFlagRow.reset", err));
  };

  const a11yLabel = `${def.label}, ${name}`;
  const boolValue = raw === true;

  let control: React.ReactNode = null;
  let below: React.ReactNode = null;
  switch (def.type) {
    case "bool":
      control = <Toggle value={boolValue} onValueChange={(next) => apply(next)} tint={C.text} trackTint={C.textLight} accessibilityLabel={a11yLabel} testID={`flag-${name}`} />;
      break;
    case "number": {
      const value = typeof raw === "number" ? raw : def.default;
      const step = def.step ?? 1;
      control = (
        <NumberControl
          def={def}
          value={value}
          step={step}
          a11yLabel={a11yLabel}
          onApply={(n) => apply(n, n !== def.default)}
          onError={reportError}
        />
      );
      if (def.presets && def.presets.length > 0) {
        below = (
          <DevPills
            items={def.presets.map((p) => ({ key: String(p), label: formatFlagNumber(p, step) }))}
            value={String(value)}
            onChange={(k) => {
              const n = Number(k);
              apply(n, n !== def.default);
            }}
            role="radiogroup"
            feedback="none"
            size="sm"
            wrap
            accessibilityLabel={`${a11yLabel} presets`}
          />
        );
      }
      break;
    }
    case "enum":
      below = (
        <DevPills
          items={def.values.map((v) => ({ key: v, label: v }))}
          value={typeof raw === "string" ? raw : def.default}
          onChange={(v) => apply(v, v !== def.default)}
          role="radiogroup"
          feedback="none"
          size="sm"
          wrap
          accessibilityLabel={a11yLabel}
        />
      );
      break;
    case "string":
      below = (
        <StringControl
          def={def}
          value={typeof raw === "string" ? raw : def.default}
          a11yLabel={a11yLabel}
          onApply={(s) => apply(s, s !== def.default)}
        />
      );
      break;
  }

  return (
    <View style={styles.row} testID={`flag-row-${name}`}>
      <View style={[styles.marker, changed && styles.markerChanged]} accessibilityElementsHidden importantForAccessibility="no" />
      <View style={styles.content}>
        <Pressable
          onPress={def.type === "bool" ? () => apply(!boolValue, !boolValue) : undefined}
          onLongPress={reset}
          delayLongPress={RESET_LONG_PRESS_MS}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          accessibilityHint={changed ? "Long press to reset to default" : def.type === "bool" ? "Toggles the flag" : undefined}
          accessibilityState={def.type === "bool" ? { checked: boolValue } : undefined}
          style={({ pressed }) => [styles.main, pressed && styles.mainPressed]}
        >
          <View style={styles.textCol}>
            <Text style={styles.label} maxFontSizeMultiplier={1.3}>
              {def.label}
            </Text>
            <ValueChip value={name} numberOfLines={3} accessibilityLabel={`Flag name ${name}`} style={styles.nameChip} />
            <Text style={styles.help} maxFontSizeMultiplier={1.3}>
              {def.help}
            </Text>
          </View>
          {control ? <View style={styles.control}>{control}</View> : null}
        </Pressable>
        {below ? <View style={styles.below}>{below}</View> : null}
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3}>
            {error}
          </Text>
        ) : null}
        {def.restart && changed ? (
          <Text style={styles.restart} maxFontSizeMultiplier={1.3}>
            Restart to apply
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ─── Number control ───────────────────────────────────────────────────────────

type NumberControlProps = {
  def: NumberFlagDef;
  value: number;
  step: number;
  a11yLabel: string;
  onApply: (n: number) => void;
  onError: (message: string) => void;
};

/**
 * `[−] 300 [+]`: 32 px IconButtons (silent — the row plays `toggle`), value chip tap → inline decimal-pad editor. Return
 * commits and unmounts the Input, whose blur would commit the same draft again — `committedRef` makes one edit one commit.
 */
function NumberControl({ def, value, step, a11yLabel, onApply, onError }: NumberControlProps): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const committedRef = useRef(false);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    setEditing(false);
    const trimmed = draft.trim();
    const n = Number(trimmed);
    if (trimmed === "" || !Number.isFinite(n)) {
      onError(`Expected a number between ${def.min} and ${def.max}`);
      return;
    }
    if (n !== value) onApply(n);
  };

  return (
    <View style={styles.numberRow}>
      <IconButton
        icon="minus"
        size={32}
        iconSize={18}
        haptic={false}
        disabled={value <= def.min}
        onPress={() => onApply(stepValue(value, step, -1, def))}
        accessibilityLabel={`Decrease ${a11yLabel}`}
      />
      {editing ? (
        <Input
          variant="underline"
          value={draft}
          onChangeText={setDraft}
          keyboardType={def.min < 0 ? "numbers-and-punctuation" : "decimal-pad"}
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
          onSubmitEditing={commit}
          onBlur={commit}
          containerStyle={styles.numberEditor}
          inputStyle={devText.code}
          focusColor={C.text}
          accessibilityLabel={`${a11yLabel} value`}
          maxLength={10}
        />
      ) : (
        <ValueChip
          value={formatFlagNumber(value, step)}
          onPress={() => {
            committedRef.current = false;
            setDraft(formatFlagNumber(value, step));
            setEditing(true);
          }}
          accessibilityLabel={`${a11yLabel}, ${formatFlagNumber(value, step)}. Tap to type a value`}
          style={styles.numberValue}
        />
      )}
      <IconButton
        icon="plus"
        size={32}
        iconSize={18}
        haptic={false}
        disabled={value >= def.max}
        onPress={() => onApply(stepValue(value, step, 1, def))}
        accessibilityLabel={`Increase ${a11yLabel}`}
      />
    </View>
  );
}

// ─── String control ───────────────────────────────────────────────────────────

type StringControlProps = {
  def: StringFlagDef;
  value: string;
  a11yLabel: string;
  onApply: (s: string) => void;
};

/** Underline Input + "Apply" (xs secondary) + "Clear" while set; empty string = unset (the registry default). */
function StringControl({ def, value, a11yLabel, onApply }: StringControlProps): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  // Follow external changes (reset, import) without an effect.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setDraft(value);
  }
  const dirty = draft.trim() !== value;

  return (
    <View style={styles.stringCol}>
      <Input
        variant="underline"
        value={draft}
        onChangeText={setDraft}
        placeholder={def.placeholder ?? "Empty = default"}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={() => onApply(draft.trim())}
        inputStyle={devText.code}
        focusColor={C.text}
        accessibilityLabel={`${a11yLabel} value`}
        helper={def.validate ? `Format: ${def.placeholder ?? def.validate.source}` : undefined}
      />
      <View style={styles.stringButtons}>
        <PrimaryButton label="Apply" size="xs" variant="secondary" disabled={!dirty} onPress={() => onApply(draft.trim())} accessibilityLabel={`Apply ${a11yLabel}`} />
        {value !== "" ? (
          <PrimaryButton
            label="Clear"
            size="xs"
            variant="secondary"
            onPress={() => {
              setDraft("");
              onApply("");
            }}
            accessibilityLabel={`Clear ${a11yLabel}`}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
  marker: { width: 3, backgroundColor: "transparent" },
  markerChanged: { backgroundColor: C.warning },
  content: { flex: 1, paddingLeft: 9, paddingRight: 4 },
  main: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  mainPressed: { backgroundColor: C.bgSoft },
  textCol: { flex: 1, gap: 4 },
  label: { ...text.rowTitle },
  nameChip: { alignSelf: "flex-start" },
  help: { ...text.rowSubtitle, lineHeight: 16 },
  control: { alignItems: "flex-end", justifyContent: "center" },
  below: { paddingBottom: 10 },
  error: { fontFamily: fontFamily.medium, fontSize: 11, lineHeight: 14, color: C.danger, paddingBottom: 8 },
  restart: { fontFamily: fontFamily.medium, fontSize: 11, lineHeight: 14, color: C.warningText, paddingBottom: 8 },
  numberRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  numberValue: { minWidth: 44, alignItems: "center" },
  numberEditor: { width: NUMBER_EDITOR_WIDTH },
  stringCol: { gap: 8 },
  stringButtons: { flexDirection: "row", gap: 8 },
});
