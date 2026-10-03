// The one address-details form, shared by /location/add-details and /location/edit (design/blinkit-parity
// §3.20): underline Inputs, Home / Work / Other label chips (+ a custom label for Other), a "Set as default"
// row with a Toggle, and delivery instructions with a counter. Fully controlled — the screen owns `value`,
// runs `validateAddressForm` on submit, passes the `errors` map back and bumps `shakeTrigger` so the first
// errored field shakes and takes focus (W15-location-foundations, 2026-10-03).
import React, { useEffect, useRef } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextInput, type ViewStyle } from "react-native";

import { Chip, Input, ListRow, Toggle } from "../ui";
import { C } from "../../constants/colors";
import { fontFamily, text } from "../../constants/ui";
import type { SavedAddress } from "../../lib/addressService";

export type AddressFormValue = {
  houseNo: string;
  floor: string;
  landmark: string;
  receiverName: string;
  receiverPhone: string;
  label: "Home" | "Work" | "Other";
  customLabel: string;
  isDefault: boolean;
  instructions: string;
};

export type AddressFormErrors = Partial<Record<keyof AddressFormValue, string>>;

export const EMPTY_ADDRESS_FORM: AddressFormValue = {
  houseNo: "",
  floor: "",
  landmark: "",
  receiverName: "",
  receiverPhone: "",
  label: "Home",
  customLabel: "",
  isDefault: false,
  instructions: "",
};

export type AddressFormProps = {
  value: AddressFormValue;
  onChange: (next: AddressFormValue) => void;
  /** From `validateAddressForm`; each message renders under its field in C.danger. */
  errors?: AddressFormErrors;
  /** Increment on a failed submit: the FIRST errored field (in visual order) shakes and takes focus. */
  shakeTrigger?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const LABELS: readonly AddressFormValue["label"][] = ["Home", "Work", "Other"];
const LABEL_ICONS = { Home: "home-outline", Work: "office-building-outline", Other: "map-marker-outline" } as const;
const INSTRUCTIONS_MAX = 200;
const PHONE_DIGITS = 10;

/** Visual order of the fields — the first key present in `errors` gets the shake and the focus. */
const FIELD_ORDER: readonly (keyof AddressFormValue)[] = [
  "houseNo",
  "floor",
  "landmark",
  "receiverName",
  "receiverPhone",
  "label",
  "customLabel",
  "isDefault",
  "instructions",
];

/** Keeps the field to the 10 local digits: strips non-digits, drops a pasted "+91" / leading "0", caps at 10. */
function toLocalPhoneDigits(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, PHONE_DIGITS);
}

/** Controlled address form: underline Inputs, label Chips, "Set as default" ListRow + Toggle, instructions with counter. */
export function AddressForm({ value, onChange, errors, shakeTrigger = 0, style, testID }: AddressFormProps): React.JSX.Element {
  const inputs = useRef<Partial<Record<keyof AddressFormValue, TextInput | null>>>({});
  const lastShakeRef = useRef(shakeTrigger);

  const firstErrorKey = FIELD_ORDER.find((key) => !!errors?.[key]);

  // Focus the first errored field once per shake (the value present at mount does nothing — restored
  // state stays still, matching Shake's own contract).
  useEffect(() => {
    if (lastShakeRef.current === shakeTrigger) return;
    lastShakeRef.current = shakeTrigger;
    if (firstErrorKey) inputs.current[firstErrorKey]?.focus();
  }, [shakeTrigger, firstErrorKey]);

  const set = <K extends keyof AddressFormValue>(key: K, next: AddressFormValue[K]) => {
    if (value[key] === next) return;
    onChange({ ...value, [key]: next });
  };
  const shakeFor = (key: keyof AddressFormValue) => (firstErrorKey === key ? shakeTrigger : undefined);
  const refFor = (key: keyof AddressFormValue) => (el: TextInput | null) => {
    inputs.current[key] = el;
  };

  const isOtherLabel = value.label === "Other";

  return (
    <View style={[styles.form, style]} testID={testID}>
      <Input
        label="House / flat number"
        placeholder="e.g. 12B, Sunrise Apartments"
        value={value.houseNo}
        onChangeText={(t) => set("houseNo", t)}
        error={errors?.houseNo}
        shakeTrigger={shakeFor("houseNo")}
        inputRef={refFor("houseNo")}
        autoCapitalize="words"
        returnKeyType="next"
        onSubmitEditing={() => inputs.current.floor?.focus()}
        containerStyle={styles.field}
        testID={testID ? `${testID}-houseNo` : undefined}
      />
      <Input
        label="Floor (optional)"
        placeholder="e.g. 3rd floor"
        value={value.floor}
        onChangeText={(t) => set("floor", t)}
        error={errors?.floor}
        shakeTrigger={shakeFor("floor")}
        inputRef={refFor("floor")}
        returnKeyType="next"
        onSubmitEditing={() => inputs.current.landmark?.focus()}
        containerStyle={styles.field}
        testID={testID ? `${testID}-floor` : undefined}
      />
      <Input
        label="Landmark (optional)"
        placeholder="e.g. Opposite the park gate"
        value={value.landmark}
        onChangeText={(t) => set("landmark", t)}
        error={errors?.landmark}
        shakeTrigger={shakeFor("landmark")}
        inputRef={refFor("landmark")}
        autoCapitalize="sentences"
        returnKeyType="next"
        onSubmitEditing={() => inputs.current.receiverName?.focus()}
        containerStyle={styles.field}
        testID={testID ? `${testID}-landmark` : undefined}
      />

      <Text style={styles.eyebrow} maxFontSizeMultiplier={1.3} accessibilityRole="header">
        Receiver
      </Text>
      <Input
        label="Receiver's name"
        placeholder="Who should we hand the order to?"
        value={value.receiverName}
        onChangeText={(t) => set("receiverName", t)}
        error={errors?.receiverName}
        shakeTrigger={shakeFor("receiverName")}
        inputRef={refFor("receiverName")}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        onSubmitEditing={() => inputs.current.receiverPhone?.focus()}
        containerStyle={styles.field}
        testID={testID ? `${testID}-receiverName` : undefined}
      />
      <Input
        label="Receiver's phone (optional)"
        placeholder="10-digit mobile number"
        value={value.receiverPhone}
        onChangeText={(t) => set("receiverPhone", toLocalPhoneDigits(t))}
        error={errors?.receiverPhone}
        shakeTrigger={shakeFor("receiverPhone")}
        inputRef={refFor("receiverPhone")}
        left={
          <Text style={styles.prefix} maxFontSizeMultiplier={1.3}>
            +91
          </Text>
        }
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        returnKeyType="done"
        containerStyle={styles.field}
        testID={testID ? `${testID}-receiverPhone` : undefined}
      />

      <Text style={styles.eyebrow} maxFontSizeMultiplier={1.3} accessibilityRole="header">
        Save as
      </Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {LABELS.map((label) => {
          const selected = value.label === label;
          return (
            <Chip
              key={label}
              label={label}
              icon={LABEL_ICONS[label]}
              selected={selected}
              // `select` only when the press changes the selection; re-pressing the active chip is silent.
              haptic={selected ? false : "select"}
              accessibilityRole="radio"
              onPress={() => set("label", label)}
              accessibilityLabel={`Save as ${label}`}
              testID={testID ? `${testID}-label-${label}` : undefined}
            />
          );
        })}
      </View>
      {isOtherLabel ? (
        <Input
          label="Label"
          placeholder="e.g. Mum's place, Office 2"
          value={value.customLabel}
          onChangeText={(t) => set("customLabel", t)}
          error={errors?.customLabel}
          shakeTrigger={shakeFor("customLabel")}
          inputRef={refFor("customLabel")}
          autoCapitalize="words"
          maxLength={30}
          returnKeyType="done"
          containerStyle={styles.field}
          testID={testID ? `${testID}-customLabel` : undefined}
        />
      ) : null}

      <ListRow
        size="lg"
        iconBg="transparent"
        icon="star-outline"
        title="Set as default"
        subtitle="Deliver here unless you pick another address"
        right={
          <Toggle
            value={value.isDefault}
            onValueChange={(next) => set("isDefault", next)}
            accessibilityLabel="Set as default"
            testID={testID ? `${testID}-isDefault` : undefined}
          />
        }
        style={styles.defaultRow}
      />

      <Input
        label="Delivery instructions (optional)"
        placeholder="e.g. Ring the bell twice, leave with security"
        value={value.instructions}
        onChangeText={(t) => set("instructions", t)}
        error={errors?.instructions}
        shakeTrigger={shakeFor("instructions")}
        inputRef={refFor("instructions")}
        multiline
        numberOfLines={3}
        maxLength={INSTRUCTIONS_MAX}
        showCounter
        textAlignVertical="top"
        inputStyle={styles.multiline}
        containerStyle={styles.field}
        testID={testID ? `${testID}-instructions` : undefined}
      />
    </View>
  );
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** The one local copy (CONTRACTS §4.18): E.164 `+91XXXXXXXXXX` or null. Dedupe with app/location/* in W3 (MAP K12). */
function normalizeIndianPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const local =
    digits.length === 12 && digits.startsWith("91")
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith("0")
        ? digits.slice(1)
        : digits;
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

/** houseNo + receiverName required; receiverPhone (when given) must normalise to 10 Indian mobile digits. */
export function validateAddressForm(value: AddressFormValue): AddressFormErrors {
  const errors: AddressFormErrors = {};
  if (!value.houseNo.trim()) errors.houseNo = "Enter the house or flat number";
  if (!value.receiverName.trim()) errors.receiverName = "Enter the receiver's name";
  if (value.receiverPhone.trim() && !normalizeIndianPhone(value.receiverPhone)) {
    errors.receiverPhone = "Enter a valid 10-digit mobile number";
  }
  return errors;
}

/** E.164 phone for the API (`contact_phone` / `receiver_phone`), or undefined when empty / invalid. */
export function addressFormPhone(value: AddressFormValue): string | undefined {
  return value.receiverPhone.trim() ? normalizeIndianPhone(value.receiverPhone) ?? undefined : undefined;
}

/** The label to store: "Home" / "Work", or the custom label for "Other" (falls back to "Other"). */
export function addressFormLabel(value: AddressFormValue): string {
  return value.label === "Other" ? value.customLabel.trim() || "Other" : value.label;
}

/**
 * Form state from a saved row. The house line is recovered from `address` by stripping the
 * `google_formatted_address` suffix add-details appends ("<house line>, <formatted>"); the phone is shown as
 * its 10 local digits.
 */
export function addressFormFromSaved(a: SavedAddress): AddressFormValue {
  const rawLabel = (a.label ?? "").trim();
  const known = rawLabel.toLowerCase();
  const label: AddressFormValue["label"] = known === "home" ? "Home" : known === "work" ? "Work" : "Other";

  const full = (a.address ?? "").trim();
  const formatted = (a.google_formatted_address ?? "").trim();
  let houseNo = "";
  if (formatted && full.endsWith(formatted) && full.length > formatted.length) {
    houseNo = full.slice(0, full.length - formatted.length).replace(/[,\s]+$/, "");
  }

  return {
    ...EMPTY_ADDRESS_FORM,
    houseNo,
    landmark: a.landmark ?? "",
    receiverName: a.receiver_name ?? a.contact_name ?? "",
    receiverPhone: toLocalPhoneDigits(a.receiver_phone ?? a.contact_phone ?? ""),
    label,
    customLabel: label === "Other" ? rawLabel : "",
    isDefault: !!a.is_default,
    instructions: a.delivery_instructions ?? "",
  };
}

const styles = StyleSheet.create({
  form: { gap: 4 },
  field: { marginBottom: 12 },
  eyebrow: { ...text.eyebrow, marginTop: 8, marginBottom: 10 },
  prefix: { fontFamily: fontFamily.semibold, fontSize: 16, color: C.text, paddingRight: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  // Flush with the underline fields (ListRow lg pads 16 on its own).
  defaultRow: { paddingHorizontal: 0, marginBottom: 4 },
  multiline: { minHeight: 72, paddingTop: 12 },
});
