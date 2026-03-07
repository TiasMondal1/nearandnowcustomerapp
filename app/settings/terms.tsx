import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../../constants/colors";


export default function TermsAndPrivacyScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Terms &amp; Privacy</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.pageSubtitle}>Near&amp;Now — User Agreement &amp; Data Protection Policy</Text>

        <View style={styles.card}>
          <PolicySection title="1. Introduction">
            <Paragraph>
              Near&Now is a sub-application developed as an initiative by{" "}
              <Bold>Synergy Subsystems Ltd</Bold>. The purpose of Near&Now is to
              enable users to discover nearby stores, browse products, and place
              delivery orders through a unified digital platform.
            </Paragraph>

            <Paragraph>
              For clarity and legal distinction, <Bold>Near&Now</Bold> and{" "}
              <Bold>Synergy Subsystems Ltd</Bold> operate as{" "}
              <Bold>separate identities</Bold>. Synergy Subsystems Ltd acts
              solely as the technology provider and developer of the platform
              infrastructure.
            </Paragraph>
          </PolicySection>

          <Divider />

          <PolicySection title="2. Ownership & Responsibility">
            <Paragraph>
              Near&Now is not a marketplace owner, retailer, or logistics
              operator. Individual stores, vendors, and delivery partners are
              independently owned and operated.
            </Paragraph>

            <Paragraph>
              Synergy Subsystems Ltd does not assume responsibility for product
              quality, pricing accuracy, fulfillment delays, or service
              availability offered by third-party merchants.
            </Paragraph>
          </PolicySection>

          <Divider />

          <PolicySection title="3. Terms of Use">
            <Bullet>
              You must be at least 18 years of age to use Near&Now.
            </Bullet>
            <Bullet>
              You agree to provide accurate and truthful information.
            </Bullet>
            <Bullet>
              Any misuse, abuse, or fraudulent activity may result in account
              suspension or termination.
            </Bullet>
            <Bullet>
              Near&Now reserves the right to modify or discontinue services
              without prior notice.
            </Bullet>
          </PolicySection>

          <Divider />

          <PolicySection title="4. Payments & Transactions">
            <Paragraph>
              All payments processed through Near&Now are facilitated via
              third-party payment gateways. Near&Now does not store sensitive
              payment credentials.
            </Paragraph>

            <Paragraph>
              Refunds, cancellations, and disputes are governed by merchant
              policies and applicable local laws.
            </Paragraph>
          </PolicySection>

          <Divider />

          <PolicySection title="5. Privacy Policy">
            <Paragraph>
              Near&Now is committed to protecting user privacy and handling
              personal data responsibly.
            </Paragraph>

            <Bullet>
              Location data is collected solely to enable delivery and discovery
              services.
            </Bullet>
            <Bullet>
              Personal information is never sold to third parties.
            </Bullet>
            <Bullet>
              Data may be shared with stores or delivery partners strictly for
              order fulfillment.
            </Bullet>
            <Bullet>
              Anonymous analytics may be used to improve app performance.
            </Bullet>
          </PolicySection>

          <Divider />

          <PolicySection title="6. Data Security">
            <Paragraph>
              Industry-standard security practices are employed to safeguard
              user data. However, no digital system is entirely immune to risk.
            </Paragraph>

            <Paragraph>
              By using Near&Now, you acknowledge and accept inherent risks
              associated with digital platforms.
            </Paragraph>
          </PolicySection>

          <Divider />

          <PolicySection title="7. Limitation of Liability">
            <Paragraph>
              Under no circumstances shall Near&Now or Synergy Subsystems Ltd be
              liable for indirect, incidental, or consequential damages arising
              from use of the platform.
            </Paragraph>
          </PolicySection>

          <Divider />

          <PolicySection title="8. Updates & Amendments">
            <Paragraph>
              These Terms and Privacy Policy may be updated periodically. Users
              are encouraged to review this page regularly.
            </Paragraph>
          </PolicySection>

          <Text style={styles.footerNote}>
            By continuing to use Near&Now, you acknowledge that you have read,
            understood, and agreed to these Terms and Privacy Policy.
          </Text>
        </View>

        <View style={styles.footer}>
          <Text style={styles.companyName}>Synergy Subsystems Ltd</Text>
          <Text style={styles.companyNote}>Technology Partner</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PolicySection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

function Paragraph({ children }: { children: React.ReactNode }) {
  return <Text style={styles.paragraph}>{children}</Text>;
}

function Bullet({ children }: { children: React.ReactNode }) {
  return <Text style={styles.bullet}>• {children}</Text>;
}

function Bold({ children }: { children: React.ReactNode }) {
  return <Text style={styles.bold}>{children}</Text>;
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
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { flex: 1, textAlign: "center", color: C.text, fontSize: 18, fontWeight: "800" },

  container: { padding: 16, paddingBottom: 90 },
  pageSubtitle: { fontSize: 13, color: C.textSub, marginBottom: 16, lineHeight: 19 },

  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: C.border,
  },
  section: { marginBottom: 6 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: C.primary, marginBottom: 8 },
  paragraph: { fontSize: 13, color: C.textSub, lineHeight: 21, marginBottom: 10 },
  bullet: { fontSize: 13, color: C.textSub, lineHeight: 21, marginBottom: 6, paddingLeft: 4 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 14 },

  footerNote: { fontSize: 12, color: C.textLight, marginTop: 18, textAlign: "center", lineHeight: 18 },
  footer: { marginTop: 28, alignItems: "center" },
  companyName: { fontSize: 14, fontWeight: "800", color: C.primary },
  companyNote: { marginTop: 6, fontSize: 11, color: C.textLight },
  bold: { fontWeight: "700", color: C.text },
});
