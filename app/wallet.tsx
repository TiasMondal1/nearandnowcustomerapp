import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useState } from "react";
import {
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const T = {
  green: "#2D7A4F",
  greenLight: "#3DA668",
  greenXLight: "#EAF6EE",
  white: "#FFFFFF",
  bg: "#F8F8F6",
  bark: "#3C2F1E",
  barkMid: "#6B5744",
  barkLight: "#A89282",
  cardBorder: "rgba(60,47,30,0.08)",
};

const QUICK_AMOUNTS = [100, 250, 500, 1000];

export default function WalletScreen() {
  const [selected, setSelected] = useState<number | null>(null);
  const [custom, setCustom] = useState("");

  const finalAmount = custom.trim() !== "" ? Number(custom) : selected;
  const isValid = finalAmount != null && finalAmount > 0 && Number.isFinite(finalAmount);

  const handleAddMoney = () => {
    if (!isValid) return;
    // Razorpay / payment gateway integration goes here.
    Alert.alert(
      "Add Money",
      `Adding ₹${finalAmount} to your wallet. Payment gateway integration coming soon.`,
      [{ text: "OK" }],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
          hitSlop={8}
        >
          <MaterialCommunityIcons name="chevron-left" size={28} color={T.bark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Wallet</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Balance card */}
        <LinearGradient
          colors={[T.greenLight, T.green]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.balanceCard}
        >
          <View style={styles.balanceIconWrap}>
            <MaterialCommunityIcons name="wallet" size={28} color="rgba(255,255,255,0.9)" />
          </View>
          <Text style={styles.balanceLabel}>Available Balance</Text>
          <Text style={styles.balanceAmount}>₹0.00</Text>
          <Text style={styles.balanceSub}>Near &amp; Now Wallet</Text>
        </LinearGradient>

        {/* Add money section */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Add Money</Text>
          <Text style={styles.cardSubtitle}>Choose a quick amount or enter custom</Text>

          {/* Quick amounts */}
          <View style={styles.quickGrid}>
            {QUICK_AMOUNTS.map((amt) => (
              <TouchableOpacity
                key={amt}
                style={[
                  styles.quickBtn,
                  selected === amt && custom === "" && styles.quickBtnActive,
                ]}
                onPress={() => {
                  setSelected(amt);
                  setCustom("");
                }}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.quickBtnText,
                    selected === amt && custom === "" && styles.quickBtnTextActive,
                  ]}
                >
                  ₹{amt}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Custom amount */}
          <View style={styles.inputWrap}>
            <Text style={styles.inputPrefix}>₹</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter amount"
              placeholderTextColor={T.barkLight}
              keyboardType="number-pad"
              value={custom}
              onChangeText={(v) => {
                setCustom(v.replace(/[^0-9]/g, ""));
                if (v) setSelected(null);
              }}
              maxLength={6}
            />
          </View>

          <TouchableOpacity
            style={[styles.addBtn, !isValid && styles.addBtnDisabled]}
            onPress={handleAddMoney}
            activeOpacity={isValid ? 0.85 : 1}
          >
            <MaterialCommunityIcons
              name="plus-circle-outline"
              size={18}
              color={isValid ? T.white : T.barkLight}
            />
            <Text style={[styles.addBtnText, !isValid && styles.addBtnTextDisabled]}>
              {isValid ? `Add ₹${finalAmount}` : "Add Money"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* How it works */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>How it works</Text>
          {[
            { icon: "wallet-plus-outline" as const, text: "Add money to your wallet anytime" },
            { icon: "cart-check" as const, text: "Pay instantly at checkout — no UPI / card needed" },
            { icon: "cash-refund" as const, text: "Refunds are credited back to wallet automatically" },
          ].map(({ icon, text }) => (
            <View key={text} style={styles.howRow}>
              <View style={styles.howIconWrap}>
                <MaterialCommunityIcons name={icon} size={18} color={T.green} />
              </View>
              <Text style={styles.howText}>{text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: T.white,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 18, fontWeight: "800", color: T.bark, letterSpacing: -0.2 },
  scroll: { padding: 16, gap: 16, paddingBottom: 60 },

  balanceCard: {
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    gap: 6,
    shadowColor: T.green,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 10,
  },
  balanceIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  balanceLabel: { fontSize: 13, color: "rgba(255,255,255,0.8)", fontWeight: "600", letterSpacing: 0.3 },
  balanceAmount: { fontSize: 40, color: T.white, fontWeight: "900", letterSpacing: -1 },
  balanceSub: { fontSize: 12, color: "rgba(255,255,255,0.65)", fontWeight: "600", marginTop: 2 },

  card: {
    backgroundColor: T.white,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: T.cardBorder,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: T.bark, letterSpacing: -0.2 },
  cardSubtitle: { fontSize: 13, color: T.barkLight, fontWeight: "500", marginTop: -8 },

  quickGrid: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  quickBtn: {
    flex: 1,
    minWidth: "20%",
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: T.bg,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: T.cardBorder,
  },
  quickBtnActive: {
    backgroundColor: T.greenXLight,
    borderColor: T.green,
  },
  quickBtnText: { fontSize: 14, fontWeight: "800", color: T.barkMid },
  quickBtnTextActive: { color: T.green },

  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.bg,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: T.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  inputPrefix: { fontSize: 18, fontWeight: "800", color: T.bark },
  input: { flex: 1, fontSize: 18, fontWeight: "700", color: T.bark },

  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: T.green,
    borderRadius: 14,
    paddingVertical: 15,
    shadowColor: T.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  addBtnDisabled: {
    backgroundColor: "#E5E7EB",
    shadowOpacity: 0,
    elevation: 0,
  },
  addBtnText: { fontSize: 15, fontWeight: "800", color: T.white, letterSpacing: 0.2 },
  addBtnTextDisabled: { color: T.barkLight },

  howRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  howIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: T.greenXLight,
    alignItems: "center",
    justifyContent: "center",
  },
  howText: { flex: 1, fontSize: 13, color: T.barkMid, lineHeight: 20, fontWeight: "500", paddingTop: 8 },
});
