// codename: indigo
// PIN sheet of the D2 gate (CONTRACTS §5, design §4.1): BottomSheet snapHeight 320 titled "Developer access" with an
// underline number-pad Input (secure, autoFocus, max 8 digits) and an "Unlock" button (secondary — ink on sand, no brand
// green on dev controls). `unlockDev(pin)` decides:
// 'ok' → feedback.success() → onUnlocked (the host opens the panel only in this sheet's onDismiss, never in the same tick
// — MAP §7.5); 'wrong' → shake + feedback.error() + "Wrong PIN"; 'locked_out' → the button is disabled with a live
// "Try again in N s" countdown read from getDevLockoutUntil() (persisted, so it survives a reload).
import React, { useEffect, useState, useSyncExternalStore } from "react";
import { StyleSheet, Text, View } from "react-native";

import { C } from "../../constants/colors";
import { text } from "../../constants/ui";
import { getDevLockoutUntil, subscribeDevFlags, unlockDev } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import { logSilentFailure } from "../../lib/logSilentFailure";
import { BottomSheet, Input, PrimaryButton } from "../ui";
import { devText } from "./DevKeyValue";

export type DevUnlockSheetProps = {
  visible: boolean;
  /** User intent to close (scrim, pan, back, header close). The host sets `visible` false. */
  onClose: () => void;
  /** The PIN matched: `unlockDev()` already persisted `nn:dev:unlocked`; the host closes the sheet and opens the panel after `onDismiss`. */
  onUnlocked: () => void;
  /** Optional extra: forwarded to `BottomSheet.onDismiss` (fires after the native Modal is gone). The host opens the panel here. */
  onDismiss?: () => void;
};

/** Fixed panel height in px (CONTRACTS §4.5 / §5). */
export const DEV_UNLOCK_SHEET_HEIGHT = 320;
/** Longest PIN accepted by the field (design §4.1). */
const PIN_MAX_LENGTH = 8;
/** Countdown refresh while a lockout runs (ms). */
const COUNTDOWN_TICK_MS = 500;

/**
 * Behaviour: digits only; each added digit plays `feedback.select()`; Enter or "Unlock" submits; the field and error
 * reset every time the sheet opens. While `getDevLockoutUntil()` is in the future the button is disabled and the helper
 * reads "Try again in N s"; the attempt that triggers the lockout shows "Too many attempts".
 */
export function DevUnlockSheet({ visible, onClose, onUnlocked, onDismiss }: DevUnlockSheetProps): React.JSX.Element {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shakeTrigger, setShakeTrigger] = useState(0);
  const [busy, setBusy] = useState(false);

  // Reset the field every time the sheet opens (adjust-state-during-render — no effect, no ref read in render).
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setPin("");
      setError(null);
      setBusy(false);
    }
  }

  const lockoutUntil = useSyncExternalStore(subscribeDevFlags, getDevLockoutUntil, getDevLockoutUntil);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible || !lockoutUntil) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
    return () => clearInterval(id);
  }, [visible, lockoutUntil]);
  const remainingS = lockoutUntil ? Math.max(0, Math.ceil((lockoutUntil - now) / 1000)) : 0;
  const lockedOut = remainingS > 0;

  const handleChange = (raw: string) => {
    const digits = raw.replace(/\D+/g, "").slice(0, PIN_MAX_LENGTH);
    if (digits.length > pin.length) feedback.select();
    setPin(digits);
    if (error) setError(null);
  };

  const submit = async () => {
    if (busy || lockedOut || pin.length === 0) return;
    setBusy(true);
    try {
      const result = await unlockDev(pin);
      if (result === "ok") {
        feedback.success();
        onUnlocked();
        return;
      }
      feedback.error();
      setShakeTrigger((n) => n + 1);
      setPin("");
      setError(result === "locked_out" ? "Too many attempts" : "Wrong PIN");
    } catch (err) {
      logSilentFailure("DevUnlockSheet.unlock", err);
      feedback.error();
      setError("Could not check the PIN");
    } finally {
      setBusy(false);
    }
  };

  const helper = lockedOut ? `Try again in ${remainingS} s` : "Digits only · up to 8";

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      onDismiss={onDismiss}
      title="Developer access"
      showClose
      snapHeight={DEV_UNLOCK_SHEET_HEIGHT}
      keyboardAvoiding
      testID="dev-unlock-sheet"
    >
      <View style={styles.body}>
        <Text style={styles.lead} maxFontSizeMultiplier={1.3}>
          Enter the developer PIN to unlock dev mode on this device.
        </Text>
        <Input
          label="PIN"
          variant="underline"
          value={pin}
          onChangeText={handleChange}
          keyboardType="number-pad"
          secureTextEntry
          autoFocus
          maxLength={PIN_MAX_LENGTH}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          editable={!busy && !lockedOut}
          error={error}
          helper={helper}
          shakeTrigger={shakeTrigger}
          focusColor={C.text}
          accessibilityLabel="Developer PIN"
          autoCorrect={false}
          autoComplete="off"
          testID="dev-unlock-pin"
        />
        <PrimaryButton
          label={lockedOut ? `Locked · ${remainingS} s` : "Unlock"}
          size="md"
          variant="secondary"
          onPress={() => void submit()}
          disabled={lockedOut || pin.length === 0}
          loading={busy}
          accessibilityLabel={lockedOut ? `Locked, try again in ${remainingS} seconds` : "Unlock developer mode"}
          style={styles.button}
          testID="dev-unlock-submit"
        />
        <Text style={[devText.caption, styles.footnote]} maxFontSizeMultiplier={1.3}>
          Three wrong PINs lock this sheet for 30 s.
        </Text>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: 14, paddingTop: 2 },
  lead: { ...text.rowSubtitle, lineHeight: 18, color: C.textSub },
  button: { marginTop: 4 },
  footnote: { textAlign: "center" },
});
