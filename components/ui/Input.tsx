import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { C } from "../../constants/colors";
import { border, fontFamily, radius, text } from "../../constants/ui";
import { Collapsible } from "./motion/Collapsible";
import { dur, useMotionReduced } from "./motion/presets";
import { Shake } from "./motion/Shake";

/** Focus colour sweep C.border → C.primary (the owner's profile `Field` used 180 ms on the JS thread). */
const FOCUS_MS = 180;

type FocusHandler = NonNullable<TextInputProps["onFocus"]>;
type BlurHandler = NonNullable<TextInputProps["onBlur"]>;

export type InputProps = Omit<TextInputProps, "style"> & {
  /** 12/600 C.textSub above the field (`text.label`); turns C.primary while focused, C.danger on error. */
  label?: string;
  /**
   * underline (default, lifted from app/settings/profile.tsx `Field`): borderBottomWidth 1.5 (`border.input`),
   * colour C.border → C.primary on focus via `interpolateColor` on the UI thread, 16 px Medium text,
   * paddingHorizontal 2, minHeight 44 ·
   * outlined: r12 1px border (same colour sweep), ph14, minHeight 48.
   */
  variant?: "underline" | "outlined";
  /** 11/500 C.textSub under the field, inside a `Collapsible`. */
  helper?: string;
  /**
   * Replaces `helper`, drawn C.danger; the border and label turn C.danger; the field shakes once each time a NEW
   * error arrives (falsy → truthy, or a different message).
   */
  error?: string | null;
  /** Leading slot inside the border (icon, prefix). */
  left?: React.ReactNode;
  /** Trailing slot inside the border (icon button, suffix). */
  right?: React.ReactNode;
  /** With `maxLength`: "12/60" 11/500 right-aligned after the text (C.textSub; C.danger on error). */
  showCounter?: boolean;
  /** External shake: increment to shake the field (e.g. on submit with an invalid value). */
  shakeTrigger?: number;
  /** Colour the border and label sweep to on focus. Default C.primary; the dev panel passes C.text (no brand green there). */
  focusColor?: string;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  inputRef?: React.Ref<TextInput>;
  testID?: string;
};

/** Underline/outlined text field. `minHeight` never `height`; `maxFontSizeMultiplier` 1.3; `accessibilityLabel` defaults to `label`. */
export function Input(props: InputProps): React.JSX.Element {
  const {
    label,
    variant = "underline",
    helper,
    error,
    left,
    right,
    showCounter = false,
    shakeTrigger = 0,
    focusColor = C.primary,
    containerStyle,
    inputStyle,
    inputRef,
    testID,
    onFocus,
    onBlur,
    onChangeText,
    value,
    defaultValue,
    maxLength,
    editable = true,
    placeholderTextColor,
    maxFontSizeMultiplier,
    accessibilityLabel,
    ...rest
  } = props;

  const reduced = useMotionReduced();
  const hasError = !!error;
  const outlined = variant === "outlined";

  // Shake once per NEW error. Derived during render (the React-sanctioned "adjust state while rendering" pattern)
  // so there is no effect and no ref read in render (React Compiler, MAP §7.2).
  const [prevError, setPrevError] = useState<string | null | undefined>(error);
  const [errorShakes, setErrorShakes] = useState(0);
  if (error !== prevError) {
    setPrevError(error);
    if (error) setErrorShakes(errorShakes + 1);
  }

  // Uncontrolled inputs keep their own length for the counter; controlled ones read `value`.
  const [ownLength, setOwnLength] = useState(() => (value ?? defaultValue ?? "").length);
  const length = value !== undefined ? value.length : ownLength;

  const focus = useSharedValue(0);
  const handleFocus: FocusHandler = (e) => {
    focus.set(withTiming(1, { duration: reduced ? 0 : dur(FOCUS_MS) }));
    onFocus?.(e);
  };
  const handleBlur: BlurHandler = (e) => {
    focus.set(withTiming(0, { duration: reduced ? 0 : dur(FOCUS_MS) }));
    onBlur?.(e);
  };
  const handleChangeText = (t: string) => {
    if (value === undefined) setOwnLength(t.length);
    onChangeText?.(t);
  };

  const borderStyle = useAnimatedStyle(() => ({
    borderColor: hasError ? C.danger : interpolateColor(focus.get(), [0, 1], [C.border, focusColor]),
  }));
  const labelColorStyle = useAnimatedStyle(() => ({
    color: hasError ? C.danger : interpolateColor(focus.get(), [0, 1], [C.textSub, focusColor]),
  }));

  const message = error || helper;

  return (
    <View style={containerStyle} testID={testID}>
      {label ? (
        <Animated.Text style={[styles.label, labelColorStyle]} maxFontSizeMultiplier={1.3}>
          {label}
        </Animated.Text>
      ) : null}
      <Shake trigger={errorShakes + shakeTrigger}>
        <Animated.View style={[outlined ? styles.outlined : styles.underline, !editable && styles.disabled, borderStyle]}>
          {left}
          <TextInput
            {...rest}
            ref={inputRef}
            value={value}
            defaultValue={defaultValue}
            maxLength={maxLength}
            editable={editable}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onChangeText={handleChangeText}
            placeholderTextColor={placeholderTextColor ?? C.textLight}
            style={[styles.input, outlined && styles.inputOutlined, inputStyle]}
            maxFontSizeMultiplier={maxFontSizeMultiplier ?? 1.3}
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityState={{ disabled: !editable }}
          />
          {showCounter && maxLength !== undefined ? (
            <Text style={[styles.counter, hasError && styles.counterError]} maxFontSizeMultiplier={1.3}>
              {length}/{maxLength}
            </Text>
          ) : null}
          {right}
        </Animated.View>
      </Shake>
      <Collapsible open={!!message}>
        <Text
          style={hasError ? styles.error : styles.helper}
          maxFontSizeMultiplier={1.3}
          accessibilityLiveRegion={hasError ? "polite" : "none"}
        >
          {message}
        </Text>
      </Collapsible>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...text.label, marginBottom: 4 },
  // Underline input — the animated border colour is the focus signal (owner's profile Field, byte-for-byte geometry).
  underline: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: border.input,
    minHeight: 44,
  },
  outlined: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: border.thin,
    borderRadius: radius.xl,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  disabled: { opacity: 0.65 },
  input: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 16,
    color: C.text,
    paddingHorizontal: 2,
    paddingVertical: 12,
  },
  inputOutlined: { paddingHorizontal: 0 },
  counter: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    color: C.textSub,
    minWidth: 36,
    textAlign: "right",
    paddingLeft: 8,
  },
  counterError: { color: C.danger },
  helper: { fontFamily: fontFamily.medium, fontSize: 11, lineHeight: 14, color: C.textSub, marginTop: 6 },
  error: { fontFamily: fontFamily.medium, fontSize: 11, lineHeight: 14, color: C.danger, marginTop: 6 },
});
