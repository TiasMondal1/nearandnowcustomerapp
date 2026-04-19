import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { C } from '../constants/colors';
import type { PaymentPhase } from '../hooks/usePaymentFlow';

interface PhaseContent {
  title: string;
  subtitle: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}

const PHASE_CONTENT: Record<Exclude<PaymentPhase, 'idle' | 'awaiting_gateway'>, PhaseContent> = {
  preparing: {
    title: 'Setting up payment…',
    subtitle: 'Securely connecting to Razorpay. This takes just a second.',
    icon: 'shield-lock-outline',
  },
  verifying: {
    title: 'Verifying payment…',
    subtitle: "We're confirming your payment with the bank. Please don't close the app.",
    icon: 'shield-check-outline',
  },
  reconciling: {
    title: 'Confirming with bank…',
    subtitle:
      "Your payment is being settled. This can take a moment — we'll update your order automatically.",
    icon: 'bank-outline',
  },
};

interface Props {
  phase: PaymentPhase;
}

/**
 * Full-screen modal shown during the online-payment flow.
 *
 * Visible during `preparing`, `verifying`, and `reconciling`. Hidden during
 * `awaiting_gateway` (Razorpay's native sheet takes over the screen) and
 * `idle`. The modal is non-dismissable on Android back-press to prevent the
 * user from breaking the flow mid-verify.
 */
export function PaymentProcessingOverlay({ phase }: Props) {
  const visible = phase === 'preparing' || phase === 'verifying' || phase === 'reconciling';
  const content = visible
    ? PHASE_CONTENT[phase as Exclude<PaymentPhase, 'idle' | 'awaiting_gateway'>]
    : null;

  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulse]);

  if (!visible || !content) return null;

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.55] });

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        // Swallow Android back-press while a payment is in flight.
      }}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Animated.View
              style={[styles.iconHalo, { opacity: haloOpacity, transform: [{ scale }] }]}
            />
            <MaterialCommunityIcons name={content.icon} size={40} color={C.primary} />
          </View>

          <Text style={styles.title}>{content.title}</Text>
          <Text style={styles.subtitle}>{content.subtitle}</Text>

          <ActivityIndicator size="small" color={C.primary} style={styles.spinner} />

          <View style={styles.secureRow}>
            <MaterialCommunityIcons name="lock-outline" size={13} color={C.textSub} />
            <Text style={styles.secureText}>256-bit secure · Powered by Razorpay</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: C.card,
    borderRadius: 22,
    paddingHorizontal: 26,
    paddingTop: 32,
    paddingBottom: 22,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 14,
  },
  iconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: C.primaryXLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  iconHalo: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: C.primaryLight,
  },
  title: {
    color: C.text,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    color: C.textSub,
    fontSize: 13.5,
    lineHeight: 19,
    textAlign: 'center',
  },
  spinner: { marginTop: 18, marginBottom: 14 },
  secureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
    width: '100%',
    justifyContent: 'center',
  },
  secureText: { color: C.textSub, fontSize: 11.5, fontWeight: '600' },
});
