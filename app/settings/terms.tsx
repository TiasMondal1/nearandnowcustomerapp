import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Card, Divider, Screen, ScreenHeader } from "../../components/ui";
import { C } from "../../constants/colors";
import { fontFamily, layout, text } from "../../constants/ui";

// Terms & privacy — static policy copy. Typography pass only (MAP K8 / BP-37): headings are `text.h3`,
// body is `text.body` at lineHeight 22, and the 800ExtraBold faces on 12–13 px body/bullets/footnote are
// gone. The header has no `onBack` so BackButton's deep-link-safe fallback applies (MAP U27).

export default function TermsAndPrivacyScreen() {
  return (
    <Screen bg={C.card}>
      <ScreenHeader title="Terms & Privacy" backFallbackHref="/(tabs)/home" />
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.pageSubtitle}>Near&amp;Now — User Agreement &amp; Data Protection Policy</Text>

        <Card style={styles.card}>
          <PolicySection title="1. Introduction">
            <Paragraph>
              Near&Now is a digital platform that enables users to discover
              nearby stores, browse products, and place delivery orders through a
              unified experience.
            </Paragraph>
          </PolicySection>

          <Divider style={styles.sectionDivider} />

          <PolicySection title="2. Ownership & Responsibility">
            <Paragraph>
              Near&Now is not a marketplace owner, retailer, or logistics
              operator. Individual stores, vendors, and delivery partners are
              independently owned and operated.
            </Paragraph>

            <Paragraph>
              Near&Now does not assume responsibility for product quality,
              pricing accuracy, fulfillment delays, or service availability
              offered by third-party merchants.
            </Paragraph>
          </PolicySection>

          <Divider style={styles.sectionDivider} />

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

          <Divider style={styles.sectionDivider} />

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

          <Divider style={styles.sectionDivider} />

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

          <Divider style={styles.sectionDivider} />

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

          <Divider style={styles.sectionDivider} />

          <PolicySection title="7. Limitation of Liability">
            <Paragraph>
              Under no circumstances shall Near&Now be liable for indirect,
              incidental, or consequential damages arising from use of the
              platform.
            </Paragraph>
          </PolicySection>

          <Divider style={styles.sectionDivider} />

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
        </Card>

        <View style={styles.footer}>
          <Text style={styles.footerBrand}>Near & Now</Text>
          <Text style={styles.footerTagline}>Digital Dukaan, local dil se</Text>
        </View>
      </ScrollView>
    </Screen>
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
    <View>
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      {children}
    </View>
  );
}

function Paragraph({ children }: { children: React.ReactNode }) {
  return <Text style={styles.paragraph}>{children}</Text>;
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletGlyph}>•</Text>
      <Text style={styles.bullet}>{children}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

/** Long-form body: `text.body` (14/400 C.textSub) opened up to lineHeight 22 for reading. */
const BODY_LINE_HEIGHT = 22;

const styles = StyleSheet.create({
  container: { padding: layout.gutter, paddingBottom: layout.scrollBottom },
  pageSubtitle: { fontFamily: fontFamily.bold, fontSize: 13, color: C.textSub, marginBottom: 16, lineHeight: 19 },

  card: { padding: layout.cardPaddingLg },
  sectionTitle: { ...text.h3, marginBottom: 8 },
  paragraph: { ...text.body, lineHeight: BODY_LINE_HEIGHT, marginBottom: 10 },
  bulletRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
  bulletGlyph: { ...text.body, lineHeight: BODY_LINE_HEIGHT, width: 10 },
  bullet: { ...text.body, lineHeight: BODY_LINE_HEIGHT, flex: 1 },
  sectionDivider: { marginTop: 6, marginBottom: 16 },

  footerNote: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 18, color: C.textSub, marginTop: 16, textAlign: "center" },
  footer: { marginTop: 28, alignItems: "center" },
  footerBrand: { fontFamily: fontFamily.extrabold, fontSize: 16, color: C.primary },
  footerTagline: { fontFamily: fontFamily.semibold, fontSize: 12, color: C.textSub, marginTop: 4 },
});
