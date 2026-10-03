import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  ChevronRotate,
  Collapsible,
  ListRow,
  notify,
  PressableScale,
  PrimaryButton,
  Screen,
  ScreenHeader,
  SectionLabel,
  type IconName,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { fontFamily, layout, motion, text } from "../../constants/ui";
import { getAppExtra, getAppVersion } from "../../lib/appExtra";
import { logSilentFailure } from "../../lib/logSilentFailure";

// Support that works (speed-and-ease #24 · MAP C34/C21/C35 · BP-37): every quick-help row opens its app
// (WhatsApp / dialler / mail) and, when nothing can open the link, copies the address or number to the
// clipboard and says so in a toast — nothing here can silently do nothing any more. `?orderId=` (from
// tracking / order detail) prefills the WhatsApp text and the email subject. Rows are pure navigation and
// therefore silent (PLAN §5 rule 5); the FAQ uses `Collapsible` instead of the global layout animation.

// ─── Contact config ──────────────────────────────────────────────────────────
// `extra` first (app.config.js maps EXPO_PUBLIC_SUPPORT_* into it per D8), then the env var as a fallback for
// builds whose config predates the key. Both are static, so module scope is fine.
const SUPPORT_PHONE = (getAppExtra().supportPhone || process.env.EXPO_PUBLIC_SUPPORT_PHONE || "").replace(/\s/g, "").trim();
const SUPPORT_EMAIL = (getAppExtra().supportEmail || process.env.EXPO_PUBLIC_SUPPORT_EMAIL || "support@nearandnow.app").trim();
/** wa.me wants the international number without "+" or punctuation. */
const WHATSAPP_NUMBER = SUPPORT_PHONE.replace(/\D/g, "");

const FAQS: readonly { q: string; a: string }[] = [
  {
    q: "How do refunds work?",
    a: "Refunds are processed to your original payment method within 3–5 business days once approved.",
  },
  {
    // C35: matches the checkout copy — one story about cancellation across the app.
    q: "Can I cancel an order?",
    a: "Orders can be cancelled until the store accepts them. After that, contact support and we'll help.",
  },
  {
    q: "Why was my order split?",
    a: "If items are from different stores, your order is split so each store can process it independently.",
  },
];

// ─── Link opening with a clipboard fallback ──────────────────────────────────

/**
 * `canOpenURL` → `openURL` → on failure copy `fallbackText` + toast. `canOpenURL` is advisory on Android:
 * Android 11+ answers false for `tel:` / `mailto:` unless the manifest declares `<queries>` for them (ours
 * lists only https — see android/app/src/main/AndroidManifest.xml:13), while `openURL` still succeeds when
 * a dialler / mail app exists. So on Android only a rejected `openURL` triggers the fallback; on iOS a
 * false `canOpenURL` does too (the system schemes used here need no LSApplicationQueriesSchemes entry).
 */
async function openSupportLink(url: string, fallbackText: string): Promise<void> {
  try {
    const can = await Linking.canOpenURL(url).catch(() => false);
    if (!can && Platform.OS !== "android") throw new Error("No app can open this link");
    await Linking.openURL(url);
  } catch (err) {
    logSilentFailure("Open support link", err);
    try {
      await Clipboard.setStringAsync(fallbackText);
      notify({ title: `Copied ${fallbackText}`, message: "No app could open this link" });
    } catch (copyErr) {
      logSilentFailure("Copy support contact", copyErr);
      notify({ title: "Couldn't open this link", message: fallbackText, tone: "error" });
    }
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SupportScreen() {
  const { orderId } = useLocalSearchParams<{ orderId?: string }>();
  const orderRef = typeof orderId === "string" && orderId.trim() ? orderId.trim() : null;
  const { version, build } = getAppVersion();

  const subject = orderRef ? `Support request — Order #${orderRef}` : "Support request";
  const whatsappText = orderRef ? `Order #${orderRef} — ` : "";

  const openWhatsApp = useCallback(() => {
    void openSupportLink(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(whatsappText)}`, SUPPORT_PHONE);
  }, [whatsappText]);
  const callSupport = useCallback(() => {
    void openSupportLink(`tel:${SUPPORT_PHONE}`, SUPPORT_PHONE);
  }, []);
  const emailSupport = useCallback(() => {
    void openSupportLink(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`, SUPPORT_EMAIL);
  }, [subject]);
  const escalate = useCallback(() => {
    const urgent = orderRef ? `Urgent issue — Order #${orderRef}` : "Urgent issue";
    void openSupportLink(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(urgent)}`, SUPPORT_EMAIL);
  }, [orderRef]);

  const openTerms = useCallback(() => {
    router.push("/settings/terms");
  }, []);

  const hasPhone = WHATSAPP_NUMBER.length > 0;

  return (
    <Screen bg={C.card}>
      <ScreenHeader title="Support" backFallbackHref="/(tabs)/home" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {orderRef ? (
          <View style={styles.orderBand}>
            <Text style={styles.orderBandText}>About order #{orderRef}</Text>
          </View>
        ) : null}

        <SectionLabel style={styles.groupLabel}>Quick help</SectionLabel>
        <View style={styles.group}>
          {hasPhone ? (
            <SupportRow
              icon="whatsapp"
              title="Chat on WhatsApp"
              subtitle={SUPPORT_PHONE}
              accessibilityLabel={`Chat on WhatsApp, ${SUPPORT_PHONE}`}
              onPress={openWhatsApp}
            />
          ) : null}
          {hasPhone ? (
            <SupportRow
              icon="phone-outline"
              title="Call us"
              subtitle={SUPPORT_PHONE}
              accessibilityLabel={`Call support, ${SUPPORT_PHONE}`}
              onPress={callSupport}
            />
          ) : null}
          <SupportRow
            icon="email-outline"
            title="Email us"
            subtitle={SUPPORT_EMAIL}
            accessibilityLabel={`Email support, ${SUPPORT_EMAIL}`}
            onPress={emailSupport}
            isLast
          />
        </View>

        <View style={styles.band} />

        <SectionLabel style={styles.groupLabel}>FAQs</SectionLabel>
        <View style={styles.group}>
          {FAQS.map((item, i) => (
            <FAQ key={item.q} q={item.q} a={item.a} isLast={i === FAQS.length - 1} />
          ))}
        </View>

        <View style={styles.band} />

        <SectionLabel style={styles.groupLabel}>App</SectionLabel>
        <View style={styles.group}>
          {/* C21: read from app.config.js via getAppVersion(), never a literal. */}
          <ListRow title="Version" titleStyle={styles.infoTitle} value={`${version} (${build})`} divider />
          <ListRow title="Terms of service" titleStyle={styles.infoTitle} onPress={openTerms} divider />
          <ListRow title="Privacy policy" titleStyle={styles.infoTitle} onPress={openTerms} />
        </View>

        <View style={styles.escalateWrap}>
          <PrimaryButton
            variant="danger"
            icon="alert-octagon-outline"
            label="Escalate an issue"
            onPress={escalate}
            accessibilityLabel="Escalate an issue by email"
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

function SupportRow({
  icon,
  title,
  subtitle,
  accessibilityLabel,
  onPress,
  isLast,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  accessibilityLabel: string;
  onPress: () => void;
  isLast?: boolean;
}) {
  // Bare glyph (iconBg transparent) — the flat Uber-style row the owner's ProfileMenu established.
  return (
    <ListRow
      icon={icon}
      iconBg="transparent"
      iconColor={C.text}
      title={title}
      titleLines={1}
      subtitle={subtitle}
      onPress={onPress}
      divider={!isLast}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

function FAQ({ q, a, isLast }: { q: string; a: string; isLast?: boolean }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return (
    <View style={!isLast && styles.rowBorder}>
      {/* Header press only reveals copy — silent (no haptic); the chevron is decorative, `expanded` carries the state. */}
      <PressableScale
        scale={motion.scale.row}
        pressedStyle={styles.rowPressed}
        innerStyle={styles.faqQ}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={q}
        accessibilityState={{ expanded: open }}
      >
        <Text style={styles.faqQText}>{q}</Text>
        <ChevronRotate open={open} size={18} color={C.textSub} />
      </PressableScale>
      <Collapsible open={open}>
        <Text style={styles.faqA}>{a}</Text>
      </Collapsible>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrollContent: { paddingBottom: layout.scrollBottom },

  orderBand: { paddingHorizontal: layout.gutter + 2, paddingTop: 14 },
  orderBandText: { fontFamily: fontFamily.semibold, fontSize: 13, color: C.textSub },

  // Label at gutter + 2 (SectionLabel's own ph2); rows at group ph4 + ListRow md ph14 = 18 so glyphs align with it.
  groupLabel: { paddingHorizontal: layout.gutter + 2, paddingTop: 20, marginBottom: 4 },
  group: { paddingHorizontal: 4, paddingBottom: 8 },
  band: { height: 8, backgroundColor: C.surfaceBand },

  rowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  rowPressed: { backgroundColor: C.bgSoft },
  faqQ: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: layout.rowPaddingX,
    paddingVertical: 14,
    minHeight: 44,
  },
  faqQText: { color: C.text, fontFamily: fontFamily.semibold, fontSize: 14, flex: 1 },
  faqA: { ...text.bodySm, paddingHorizontal: layout.rowPaddingX, paddingBottom: 14 },

  infoTitle: { fontFamily: fontFamily.regular },

  escalateWrap: { paddingHorizontal: layout.gutter, paddingTop: 20 },
});
