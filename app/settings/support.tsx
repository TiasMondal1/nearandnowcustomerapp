import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
    LayoutAnimation,
    Linking,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import { Badge, ListRow, PrimaryButton, Screen, ScreenHeader, Section, type IconName } from "../../components/ui";
import { C } from "../../constants/colors";
import { layout } from "../../constants/ui";

const SUPPORT_PHONE_E164 = (process.env.EXPO_PUBLIC_SUPPORT_PHONE || "").trim();

export default function SupportScreen() {
  return (
    <Screen>
      <ScreenHeader title="Support" onBack={() => router.back()} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <Section title="Quick Help">
          <SupportAction
            icon="package-variant-closed"
            title="Order Issues"
            subtitle="Missing items, wrong order"
            onPress={() => Linking.openURL("mailto:support@nearandnow.app?subject=Order%20Issue")}
          />
          <SupportAction
            icon="credit-card-outline"
            title="Payments & Refunds"
            subtitle="Charges, refunds, failed payments"
            onPress={() => Linking.openURL("mailto:support@nearandnow.app?subject=Payment%20or%20Refund%20Issue")}
          />
          <SupportAction
            icon="truck-delivery-outline"
            title="Delivery Problems"
            subtitle="Late or incomplete delivery"
            onPress={() => Linking.openURL("mailto:support@nearandnow.app?subject=Delivery%20Problem")}
            isLast
          />
        </Section>

        <Section title="Contact Us">
          <SupportAction
            icon="email-outline"
            title="Email Us"
            subtitle="support@nearandnow.app"
            onPress={() => Linking.openURL("mailto:support@nearandnow.app")}
            isLast={!SUPPORT_PHONE_E164}
          />
          {SUPPORT_PHONE_E164 ? (
            <SupportAction
              icon="phone-outline"
              title="Call Support"
              subtitle={SUPPORT_PHONE_E164}
              onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE_E164.replace(/\s/g, "")}`)}
              isLast
            />
          ) : null}
        </Section>

        <Section title="FAQs">
          <FAQ q="How do refunds work?" a="Refunds are processed to your original payment method within 3–5 business days once approved." />
          <FAQ q="Can I cancel an order?" a="Orders can be cancelled before the store accepts them. After acceptance, cancellation may not be possible." />
          <FAQ q="Why was my order split?" a="If items are from different stores, your order is split so each store can process it independently." isLast />
        </Section>

        <Section title="App Information">
          <InfoRow label="App Version" value="1.0.0" />
          <InfoRow label="Terms of Service" onPress={() => router.push("/settings/terms")} />
          <InfoRow label="Privacy Policy" onPress={() => router.push("/settings/terms")} isLast />
        </Section>

        <PrimaryButton
          variant="danger"
          icon="alert-octagon-outline"
          label="Escalate an Issue"
          style={styles.escalate}
          onPress={() => Linking.openURL("mailto:support@nearandnow.app?subject=Urgent Issue")}
        />
      </ScrollView>
    </Screen>
  );
}

function SupportAction({
  icon, title, subtitle, badge, onPress, isLast,
}: {
  icon: IconName; title: string; subtitle: string;
  badge?: string; onPress?: () => void; isLast?: boolean;
}) {
  return (
    <ListRow
      icon={icon}
      title={title}
      titleLines={1}
      subtitle={subtitle}
      onPress={onPress}
      divider={!isLast}
      right={badge ? <Badge size="sm" pill bordered tone="warning" label={badge} /> : undefined}
    />
  );
}

function FAQ({ q, a, isLast }: { q: string; a: string; isLast?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={!isLast && styles.rowBorder}>
      <TouchableOpacity
        onPress={() => { LayoutAnimation.easeInEaseOut(); setOpen(!open); }}
        style={styles.faqQ}
        activeOpacity={0.7}
        accessibilityRole="button"
      >
        <Text style={styles.faqQText}>{q}</Text>
        <MaterialCommunityIcons name={open ? "chevron-up" : "chevron-down"} size={18} color={C.textLight} />
      </TouchableOpacity>
      {open && <Text style={styles.faqA}>{a}</Text>}
    </View>
  );
}

function InfoRow({ label, value, onPress, isLast }: { label: string; value?: string; onPress?: () => void; isLast?: boolean }) {
  return (
    <ListRow
      title={label}
      titleLines={1}
      titleStyle={styles.infoTitle}
      value={value}
      onPress={onPress}
      divider={!isLast}
    />
  );
}

const styles = StyleSheet.create({
  scrollContent: { padding: layout.gutter, paddingBottom: layout.scrollBottom },

  rowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },

  faqQ: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: 14,
  },
  faqQText: { color: C.text, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 14, flex: 1 },
  faqA: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.textSub, fontSize: 13, paddingHorizontal: 14, paddingBottom: 14, lineHeight: 20 },

  infoTitle: { fontFamily: "PlusJakartaSans_400Regular" },

  escalate: { marginTop: 4 },
});
