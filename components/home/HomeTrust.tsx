// HomeTrust — Home's "Why Near & Now" row: three flat cards between product rails. Each line repeats something the
// app already states elsewhere (the 4 km shop radius on the feed's end card, the rider map on the order screen, the
// Razorpay note on the payment options screen). Not pressable, no props, so it never re-renders.
import React from "react";
import { StyleSheet } from "react-native";

import { TrustTrio, type TrustItem } from "../cards";

const ITEMS: readonly TrustItem[] = [
  { icon: "storefront-outline", title: "Local shops", body: "From kirana stores within 4 km of you" },
  { icon: "map-marker-path", title: "Live tracking", body: "See your rider on the map" },
  { icon: "shield-check-outline", title: "Secure payments", body: "Online payments are handled by Razorpay" },
];

function HomeTrustBase() {
  return <TrustTrio title="Why Near & Now" items={ITEMS} style={styles.root} testID="home-trust" />;
}

export const HomeTrust = React.memo(HomeTrustBase);
HomeTrust.displayName = "HomeTrust";

const styles = StyleSheet.create({
  root: { marginTop: 8 },
});
