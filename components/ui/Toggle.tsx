import React from "react";
import { Switch } from "react-native";

import { C } from "../../constants/colors";
import { feedback as fb } from "../../lib/feedback";

export type ToggleProps = {
  value: boolean;
  /** Receives the next value; called BEFORE the toggle feedback so the new state is applied first. */
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  /** Label for screen readers (the row title when used inside a `ListRow right={…}`). */
  accessibilityLabel?: string;
  /** Default true: `feedback.toggle(next)` (haptic + ui_toggle) after the value is applied. `false` = silent. */
  feedback?: boolean;
  /** Thumb colour while on. Default C.primary; the dev panel passes C.text (no brand green on dev controls). */
  tint?: string;
  /** Track colour while on. Default C.primaryLight; the dev panel passes C.textLight. */
  trackTint?: string;
  testID?: string;
};

/**
 * The one Switch wrapper (sirius prefs rows, dev panel bools, address default, notification prefs):
 * RN `Switch` with trackColor {false: C.border, true: trackTint (C.primaryLight)}, thumbColor tint (C.primary) / C.card,
 * ios_backgroundColor C.border, role `switch` + `checked` state. Fires `feedback.toggle(next)` once per change.
 */
export function Toggle({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
  feedback = true,
  tint = C.primary,
  trackTint = C.primaryLight,
  testID,
}: ToggleProps): React.JSX.Element {
  const handleChange = (next: boolean) => {
    onValueChange(next);
    if (feedback) fb.toggle(next);
  };
  return (
    <Switch
      value={value}
      onValueChange={handleChange}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      trackColor={{ false: C.border, true: trackTint }}
      thumbColor={value ? tint : C.card}
      ios_backgroundColor={C.border}
      testID={testID}
    />
  );
}
