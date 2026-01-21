import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
    LayoutAnimation,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    UIManager,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/* Enable layout animation on Android */
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* ───────── COLORS ───────── */
const BG = "#05030A";
const CARD = "#140F2D";
const CARD_SOFT = "#1A1440";
const PRIMARY = "#765fba";
const MUTED = "#9C94D7";
const BORDER = "#2A2450";
const GREEN = "#3CFF8F";
const YELLOW = "#FFD166";
const DANGER = "#E54848";

export default function SupportScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Support</Text>
          <Text style={styles.headerSub}>We’re here to help you anytime</Text>
        </View>

        {/* QUICK HELP */}
        <Section title="Quick Help">
          <SupportAction
            icon="package-variant-closed"
            title="Order Issues"
            subtitle="Missing items, wrong order"
          />
          <SupportAction
            icon="credit-card-outline"
            title="Payments & Refunds"
            subtitle="Charges, refunds, failed payments"
          />
          <SupportAction
            icon="truck-delivery-outline"
            title="Delivery Problems"
            subtitle="Late or incomplete delivery"
          />
        </Section>

        {/* CONTACT */}
        <Section title="Contact Support">
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
          />
          <SupportAction
            icon="phone-outline"
            title="Call Support"
            subtitle="+91 9XXXX XXXXX"
          />
        </Section>

        {/* FAQ */}
        <Section title="FAQs">
          <FAQ
            q="How do refunds work?"
            a="Refunds are processed to your original payment method within 3–5 business days once approved."
          />
          <FAQ
            q="Can I cancel an order?"
            a="Orders can be cancelled before the store accepts them. After acceptance, cancellation may not be possible."
          />
          <FAQ
            q="Why was my order split?"
            a="If items are from different stores, your order is split so each store can process it independently."
          />
        </Section>

        {/* APP INFO */}
        <Section title="App Information">
          <InfoRow label="App Version" value="1.0.0" />
          <InfoRow label="Terms of Service" />
          <InfoRow label="Privacy Policy" />
        </Section>

        {/* ESCALATION */}
        <Section title="Need urgent help?">
          <TouchableOpacity style={styles.emergency}>
            <MaterialCommunityIcons
              name="alert-octagon-outline"
              size={20}
              color="#fff"
            />
            <Text style={styles.emergencyText}>Escalate an Issue</Text>
          </TouchableOpacity>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ───────── COMPONENTS ───────── */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function SupportAction({
  icon,
  title,
  subtitle,
  badge,
}: {
  icon: any;
  title: string;
  subtitle: string;
  badge?: string;
}) {
  return (
    <TouchableOpacity activeOpacity={0.85} style={styles.action}>
      <View style={styles.actionLeft}>
        <MaterialCommunityIcons name={icon} size={22} color="#fff" />
        <View>
          <Text style={styles.actionTitle}>{title}</Text>
          <Text style={styles.actionSub}>{subtitle}</Text>
        </View>
      </View>

      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : (
        <MaterialCommunityIcons name="chevron-right" size={22} color={MUTED} />
      )}
    </TouchableOpacity>
  );
}

function FAQ({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <View>
      <TouchableOpacity
        onPress={() => {
          LayoutAnimation.easeInEaseOut();
          setOpen(!open);
        }}
        style={styles.faqQ}
      >
        <Text style={styles.faqQText}>{q}</Text>
        <MaterialCommunityIcons
          name={open ? "chevron-up" : "chevron-down"}
          size={20}
          color={MUTED}
        />
      </TouchableOpacity>

      {open && <Text style={styles.faqA}>{a}</Text>}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      {value && <Text style={styles.infoValue}>{value}</Text>}
    </View>
  );
}

/* ───────── STYLES ───────── */

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },

  header: { padding: 20 },
  headerTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "900",
  },
  headerSub: {
    color: MUTED,
    fontSize: 13,
    marginTop: 4,
  },

  section: { marginTop: 12 },
  sectionTitle: {
    color: MUTED,
    fontSize: 13,
    fontWeight: "700",
    marginLeft: 20,
    marginBottom: 6,
  },

  sectionCard: {
    backgroundColor: CARD_SOFT,
    borderRadius: 20,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: "hidden",
  },

  action: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderColor: BORDER,
  },

  actionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  actionTitle: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  actionSub: {
    color: MUTED,
    fontSize: 11,
    marginTop: 2,
  },

  badge: {
    backgroundColor: YELLOW,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "900",
    color: "#000",
  },

  faqQ: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 16,
  },
  faqQText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
    flex: 1,
    paddingRight: 10,
  },
  faqA: {
    color: MUTED,
    fontSize: 12,
    paddingHorizontal: 16,
    paddingBottom: 16,
    lineHeight: 18,
  },

  infoRow: {
    padding: 16,
    borderBottomWidth: 1,
    borderColor: BORDER,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  infoLabel: { color: "#fff", fontSize: 13 },
  infoValue: { color: MUTED, fontSize: 13 },

  emergency: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 16,
    backgroundColor: DANGER,
  },
  emergencyText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 14,
  },
});
