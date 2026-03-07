import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
    LayoutAnimation,
    Linking,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    UIManager,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../../constants/colors";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function SupportScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Support</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <Section title="Quick Help">
          <SupportAction icon="package-variant-closed" title="Order Issues" subtitle="Missing items, wrong order" />
          <SupportAction icon="credit-card-outline" title="Payments & Refunds" subtitle="Charges, refunds, failed payments" />
          <SupportAction icon="truck-delivery-outline" title="Delivery Problems" subtitle="Late or incomplete delivery" isLast />
        </Section>

        <Section title="Contact Us">
          <SupportAction
            icon="chat-processing-outline"
            title="Live Chat"
            subtitle="Chat with our support team"
            badge="Coming Soon"
          />
          <SupportAction
            icon="email-outline"
            title="Email Us"
            subtitle="support@nearandnow.app"
            onPress={() => Linking.openURL("mailto:support@nearandnow.app")}
          />
          <SupportAction
            icon="phone-outline"
            title="Call Support"
            subtitle="+91 98765 43210"
            onPress={() => Linking.openURL("tel:+919876543210")}
            isLast
          />
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

        <TouchableOpacity
          style={styles.escalate}
          onPress={() => Linking.openURL("mailto:support@nearandnow.app?subject=Urgent Issue")}
        >
          <MaterialCommunityIcons name="alert-octagon-outline" size={20} color={C.danger} />
          <Text style={styles.escalateText}>Escalate an Issue</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function SupportAction({
  icon, title, subtitle, badge, onPress, isLast,
}: {
  icon: any; title: string; subtitle: string;
  badge?: string; onPress?: () => void; isLast?: boolean;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      style={[styles.action, !isLast && styles.actionBorder]}
      onPress={onPress}
    >
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons name={icon} size={18} color={C.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionSub}>{subtitle}</Text>
      </View>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : (
        <MaterialCommunityIcons name="chevron-right" size={18} color={C.textLight} />
      )}
    </TouchableOpacity>
  );
}

function FAQ({ q, a, isLast }: { q: string; a: string; isLast?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={!isLast && styles.actionBorder}>
      <TouchableOpacity
        onPress={() => { LayoutAnimation.easeInEaseOut(); setOpen(!open); }}
        style={styles.faqQ}
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
    <TouchableOpacity
      style={[styles.action, !isLast && styles.actionBorder]}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <Text style={styles.infoLabel}>{label}</Text>
      {value
        ? <Text style={styles.infoValue}>{value}</Text>
        : onPress && <MaterialCommunityIcons name="chevron-right" size={18} color={C.textLight} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: C.bgSoft, alignItems: "center", justifyContent: "center",
  },
  headerTitle: { flex: 1, textAlign: "center", color: C.text, fontSize: 18, fontWeight: "800" },

  scrollContent: { padding: 16, paddingBottom: 40 },

  section: { marginBottom: 20 },
  sectionTitle: {
    color: C.textSub, fontSize: 11, fontWeight: "700",
    marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.7, paddingHorizontal: 2,
  },
  sectionCard: {
    backgroundColor: C.card, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, overflow: "hidden",
  },

  action: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 13, gap: 12,
  },
  actionBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  iconWrap: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: C.primaryXLight, alignItems: "center", justifyContent: "center",
  },
  actionTitle: { color: C.text, fontSize: 14, fontWeight: "700" },
  actionSub: { color: C.textSub, fontSize: 12, marginTop: 1 },

  badge: {
    backgroundColor: C.warningLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    borderWidth: 1, borderColor: C.warning,
  },
  badgeText: { fontSize: 10, fontWeight: "800", color: C.warning },

  faqQ: { flexDirection: "row", justifyContent: "space-between", padding: 14 },
  faqQText: { color: C.text, fontWeight: "600", fontSize: 13, flex: 1, paddingRight: 10 },
  faqA: { color: C.textSub, fontSize: 13, paddingHorizontal: 14, paddingBottom: 14, lineHeight: 20 },

  infoLabel: { color: C.text, fontSize: 14, flex: 1 },
  infoValue: { color: C.textSub, fontSize: 13 },

  escalate: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    marginTop: 4, paddingVertical: 14, borderRadius: 14,
    backgroundColor: C.dangerLight, borderWidth: 1, borderColor: "#fca5a5",
  },
  escalateText: { color: C.danger, fontWeight: "800", fontSize: 14 },
});
