import React from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/* ───────── COLORS ───────── */
const BG = "#05030A";
const CARD = "#120D24";
const BORDER = "#2A2450";
const MUTED = "#9C94D7";
const PRIMARY = "#765fba";

/* Logo */
const COMPANY_LOGO = require("../assets/synergy-logo.png");

export default function TermsAndPrivacyScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <Text style={styles.title}>Terms & Privacy Policy</Text>
          <Text style={styles.subtitle}>
            Near&Now — User Agreement & Data Protection Policy
          </Text>
        </View>

        {/* MAIN CARD */}
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

          {/* FINAL NOTE */}
          <Text style={styles.footerNote}>
            By continuing to use Near&Now, you acknowledge that you have read,
            understood, and agreed to these Terms and Privacy Policy.
          </Text>
        </View>

        {/* FOOTER */}
        <View style={styles.footer}>
          <Image source={COMPANY_LOGO} style={styles.logo} />
          <Text style={styles.companyNote}>
            Technology Partner: Synergy Subsystems Ltd
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ───────── COMPONENTS ───────── */

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

/* ───────── STYLES ───────── */

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },

  container: {
    padding: 16,
    paddingBottom: 90,
  },

  header: {
    marginBottom: 14,
  },

  title: {
    fontSize: 22,
    fontWeight: "900",
    color: "#fff",
  },

  subtitle: {
    fontSize: 13,
    color: MUTED,
    marginTop: 4,
  },

  card: {
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },

  section: {
    marginBottom: 6,
  },

  sectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: PRIMARY,
    marginBottom: 8,
  },

  paragraph: {
    fontSize: 13,
    color: "#ddd",
    lineHeight: 21,
    marginBottom: 10,
  },

  bullet: {
    fontSize: 13,
    color: "#ddd",
    lineHeight: 21,
    marginBottom: 6,
    paddingLeft: 4,
  },

  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 14,
  },

  footerNote: {
    fontSize: 12,
    color: MUTED,
    marginTop: 18,
    textAlign: "center",
    lineHeight: 18,
  },

  footer: {
    marginTop: 28,
    alignItems: "center",
  },

  logo: {
    width: 280,
    height: 190,
    opacity: 0.9,
    resizeMode: "contain",
  },

  companyNote: {
    marginTop: 6,
    fontSize: 11,
    color: MUTED,
  },

  bold: {
    fontWeight: "700",
    color: "#fff",
  },
});
