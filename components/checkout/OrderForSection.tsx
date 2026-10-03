// OrderForSection — "Who is this order for?" (design/blinkit-parity §3.7; inline validation M32). Two Chips
// (Myself / Someone else, the default `select` haptic only when the pick changes) and, inside a Collapsible, the
// receiver's name / 10-digit phone / optional address on underline Inputs with inline errors. Validation is the
// screen's: it derives the error strings (after blur or a Pay attempt), bumps the per-field shake counters and
// focuses through the refs; this component is a memoised view of primitives.
import React from "react";
import { StyleSheet, Text, View, type TextInput } from "react-native";

import { C } from "../../constants/colors";
import { text } from "../../constants/ui";
import { Chip, Collapsible, Input } from "../ui";

export type OrderForValue = "self" | "others";
export type ReceiverField = "receiverName" | "receiverPhone";

export type OrderForSectionProps = {
  value: OrderForValue;
  onChange: (next: OrderForValue) => void;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  onReceiverNameChange: (t: string) => void;
  /** Receives digits only (the section strips everything else, max 10). */
  onReceiverPhoneChange: (digits: string) => void;
  onReceiverAddressChange: (t: string) => void;
  nameError: string | null;
  phoneError: string | null;
  /** Monotonic counters — the screen bumps the offending field's counter on a failed Pay tap. */
  nameShake?: number;
  phoneShake?: number;
  /** Blur = the field becomes "touched" and validates inline from then on. */
  onFieldBlur?: (field: ReceiverField) => void;
  /** Lets the screen remember which section owns the keyboard (scroll-into-view on keyboardDidShow). */
  onFieldFocus?: () => void;
  nameRef?: React.Ref<TextInput>;
  phoneRef?: React.Ref<TextInput>;
  testID?: string;
};

const PHONE_LENGTH = 10;

function OrderForSectionBase({
  value,
  onChange,
  receiverName,
  receiverPhone,
  receiverAddress,
  onReceiverNameChange,
  onReceiverPhoneChange,
  onReceiverAddressChange,
  nameError,
  phoneError,
  nameShake = 0,
  phoneShake = 0,
  onFieldBlur,
  onFieldFocus,
  nameRef,
  phoneRef,
  testID,
}: OrderForSectionProps): React.JSX.Element {
  const others = value === "others";

  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
        Who is this order for?
      </Text>
      <View style={styles.chips}>
        <Chip
          label="Myself"
          selected={!others}
          haptic={others ? "select" : false}
          onPress={() => onChange("self")}
          style={styles.chip}
        />
        <Chip
          label="Someone else"
          selected={others}
          haptic={others ? false : "select"}
          onPress={() => onChange("others")}
          style={styles.chip}
        />
      </View>

      <Collapsible open={others}>
        <View style={styles.fields}>
          <Input
            label="Receiver's name"
            variant="underline"
            value={receiverName}
            onChangeText={onReceiverNameChange}
            onBlur={() => onFieldBlur?.("receiverName")}
            onFocus={onFieldFocus}
            error={nameError}
            shakeTrigger={nameShake}
            inputRef={nameRef}
            placeholder="Full name"
            autoCapitalize="words"
            returnKeyType="next"
            textContentType="name"
          />
          <Input
            label="Receiver's phone"
            variant="underline"
            value={receiverPhone}
            onChangeText={(t) => onReceiverPhoneChange(t.replace(/\D/g, "").slice(0, PHONE_LENGTH))}
            onBlur={() => onFieldBlur?.("receiverPhone")}
            onFocus={onFieldFocus}
            error={phoneError}
            helper="10-digit mobile number"
            shakeTrigger={phoneShake}
            inputRef={phoneRef}
            placeholder="98765 43210"
            keyboardType="number-pad"
            maxLength={PHONE_LENGTH}
            returnKeyType="done"
            textContentType="telephoneNumber"
          />
          <Input
            label="Receiver's address details (optional)"
            variant="underline"
            value={receiverAddress}
            onChangeText={onReceiverAddressChange}
            onFocus={onFieldFocus}
            placeholder="Flat, floor, landmark"
            multiline
            maxLength={120}
            showCounter
          />
        </View>
      </Collapsible>
    </View>
  );
}

/** Memoised on primitives; the screen passes stable handlers. */
export const OrderForSection = React.memo(OrderForSectionBase);
OrderForSection.displayName = "OrderForSection";

const styles = StyleSheet.create({
  section: { backgroundColor: C.card, paddingHorizontal: 16, paddingVertical: 14 },
  title: { ...text.h3, marginBottom: 12 },
  chips: { flexDirection: "row", gap: 8 },
  chip: { flex: 1 },
  fields: { gap: 12, paddingTop: 14 },
});
