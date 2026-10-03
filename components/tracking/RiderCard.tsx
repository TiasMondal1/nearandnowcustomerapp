// codename: mira
// RiderCard — the assigned delivery partner on the tracking screen (design/blinkit-parity §3.13): 44 px initial
// circle, name 15/700 + vehicle 13/400, and a silent 44 px "Call" IconButton (navigation out of the app, no haptic).
import React from "react";
import { Linking, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { fontFamily, layout, radius } from "../../constants/ui";
import { logSilentFailure } from "../../lib/logSilentFailure";
import { Card, IconButton, notify } from "../ui";

export type RiderCardProps = {
  /** Rider's display name ("Ravi"). */
  name: string;
  /** E.164 or local number; the Call button is hidden without one. */
  phone?: string | null;
  /** Vehicle line under the name ("WB 02 AB 1234"). Falls back to "Delivery partner". */
  vehicle?: string | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const AVATAR = 44;

/** First letter of the first word, upper-cased; "?" when the name is blank. */
export function riderInitial(name: string): string {
  const first = name.trim().charAt(0);
  return first ? first.toUpperCase() : "?";
}

/**
 * `Card size="lg"` (r16, hairline border) with avatar · name/vehicle · `IconButton icon="phone" size={44}
 * bg={C.primaryXLight} color={C.primary}` labelled "Call <name>". `Linking.openURL("tel:…")` failures are logged and
 * surfaced as an error toast with the number so the user can dial by hand.
 */
export function RiderCard({ name, phone, vehicle, style, testID }: RiderCardProps): React.JSX.Element {
  const onCall = () => {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch((err: unknown) => {
      logSilentFailure("RiderCard: call rider", err);
      notify({ id: "rider-call", tone: "error", title: "Couldn't start the call", message: `Dial ${phone} to reach ${name}` });
    });
  };

  return (
    <Card size="lg" borderColor={C.hairline} style={[styles.card, style]} testID={testID}>
      <View style={styles.avatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={styles.initial} maxFontSizeMultiplier={1.3}>
          {riderInitial(name)}
        </Text>
      </View>
      <View style={styles.textCol}>
        <Text style={styles.eyebrow} maxFontSizeMultiplier={1.3}>
          Your delivery partner
        </Text>
        <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {name}
        </Text>
        <Text style={styles.vehicle} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {vehicle?.trim() || "Delivery partner"}
        </Text>
      </View>
      {phone ? (
        <IconButton
          icon="phone"
          size={AVATAR}
          iconSize={22}
          shape="circle"
          bg={C.primaryXLight}
          color={C.primary}
          accessibilityLabel={`Call ${name}`}
          onPress={onCall}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: layout.gutter,
    marginTop: layout.cardGap,
    flexDirection: "row",
    alignItems: "center",
    gap: layout.rowGap,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radius.pill,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { fontFamily: fontFamily.bold, fontSize: 17, color: C.text },
  textCol: { flex: 1 },
  eyebrow: { fontFamily: fontFamily.medium, fontSize: 11, lineHeight: 14, color: C.textSub },
  name: { fontFamily: fontFamily.bold, fontSize: 15, color: C.text, marginTop: 1 },
  vehicle: { fontFamily: fontFamily.regular, fontSize: 13, color: C.textSub, marginTop: 1 },
});
