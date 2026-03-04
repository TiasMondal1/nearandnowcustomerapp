import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../context/AuthContext";

const BG = "#f9fafb";
const CARD = "#ffffff";
const CARD_SOFT = "#f3f4f6";
const PRIMARY = "#059669";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";
const DANGER = "#ef4444";

export default function SettingsScreen() {
  const { user, logoutUser } = useAuth();

  const handleLogout = async () => {
    await logoutUser();
    router.replace("/phone");
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.header}>Account</Text>

        <View style={styles.profileCard}>
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarText}>
              {user?.name?.charAt(0)?.toUpperCase() ?? "?"}
            </Text>
          </View>

          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.name ?? "—"}</Text>
            {user?.phone ? <Text style={styles.sub}>{user.phone}</Text> : null}
            {user?.email ? <Text style={styles.sub}>{user.email}</Text> : null}
          </View>

          <TouchableOpacity onPress={() => router.push("/settings/profile")}>
            <MaterialCommunityIcons name="pencil" size={20} color={PRIMARY} />
          </TouchableOpacity>
        </View>

        <Section title="Preferences">
          <Item
            icon="map-marker"
            title="Saved Addresses"
            subtitle="Manage delivery locations"
            onPress={() => router.push("../location/index")}
          />
          <Item
            icon="wallet"
            title="Payments"
            subtitle="UPI, cards & refunds"
            onPress={() => router.push("/settings/payments")}
          />
          <Item
            icon="bell-outline"
            title="Notifications"
            subtitle="Order & promo alerts"
            onPress={() => {}}
          />
        </Section>

        <Section title="Support">
          <Item
            icon="help-circle-outline"
            title="Help Center"
            subtitle="FAQs & contact support"
            onPress={() => router.push("/settings/support")}
          />

          <Item
            icon="file-document-outline"
            title="Terms & Privacy"
            subtitle="Legal information"
            onPress={() => router.push("/settings/terms")}
          />
        </Section>

        <View style={styles.logoutWrap}>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={18} color="#fff" />
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginTop: 28 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function Item({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: any;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.item} onPress={onPress}>
      <MaterialCommunityIcons name={icon} size={22} color={PRIMARY} />
      <View style={{ flex: 1 }}>
        <Text style={styles.itemTitle}>{title}</Text>
        <Text style={styles.itemSub}>{subtitle}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={MUTED} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
    paddingHorizontal: 16,
  },

  header: {
    color: "#1f2937",
    fontSize: 26,
    fontWeight: "900",
    marginTop: 12,
  },

  profileCard: {
    marginTop: 20,
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },

  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },

  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: PRIMARY,
    justifyContent: "center",
    alignItems: "center",
  },

  avatarText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "900",
  },

  name: {
    color: "#1f2937",
    fontSize: 16,
    fontWeight: "800",
  },

  sub: {
    color: MUTED,
    fontSize: 12,
    marginTop: 2,
  },

  sectionTitle: {
    color: MUTED,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 10,
    textTransform: "uppercase",
  },

  sectionCard: {
    backgroundColor: CARD,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },

  item: {
    flexDirection: "row",
    gap: 14,
    padding: 16,
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  itemTitle: {
    color: "#1f2937",
    fontSize: 14,
    fontWeight: "700",
  },

  itemSub: {
    color: MUTED,
    fontSize: 12,
    marginTop: 2,
  },

  logoutWrap: {
    marginTop: 40,
    alignItems: "center",
  },

  logoutBtn: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 28,
    backgroundColor: DANGER,
    borderRadius: 12,
    alignItems: "center",
  },

  logoutText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 14,
  },
});
