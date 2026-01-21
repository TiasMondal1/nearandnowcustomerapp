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
import { clearSession } from "../../session";

const BG = "#05030A";
const CARD = "#140F2D";
const CARD_SOFT = "#1A1440";
const PRIMARY = "#765fba";
const MUTED = "#9C94D7";
const BORDER = "#2A2450";
const DANGER = "#E54848";

export default function SettingsScreen() {
  const user = {
    name: "Enigma", //statenote change later CONTEXT.CONMAN/JIRA-TEMPEST/SYNEGY
    phone: "+91 9XXXX XXXXX", //statenote change later CONTEXT.CONMAN2/JIRA-TEMPEST/SYNERGY
    email: "user@email.com", ////statenote change later CONTEXT.CONMAN3/JIRA-TEMPEST/SYNERGY
    avatar_url: null,
  };

  const handleLogout = async () => {
    await clearSession();
    router.replace("/login-password");
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.header}>Account</Text>

        <View style={styles.profileCard}>
          {user.avatar_url ? (
            <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarText}>{user.name.charAt(0)}</Text>
            </View>
          )}

          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user.name}</Text>
            {user.phone && <Text style={styles.sub}>{user.phone}</Text>}
            {user.email && <Text style={styles.sub}>{user.email}</Text>}
          </View>

          <TouchableOpacity onPress={() => router.push("/settings/profile")}>
            <MaterialCommunityIcons name="pencil" size={20} color="#fff" />
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
      <MaterialCommunityIcons name={icon} size={22} color="#fff" />
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
    color: "#fff",
    fontSize: 26,
    fontWeight: "900",
    marginTop: 12,
  },

  profileCard: {
    marginTop: 20,
    backgroundColor: CARD_SOFT,
    borderRadius: 22,
    padding: 16,
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
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
    color: "#fff",
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
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 10,
  },

  sectionCard: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: "hidden",
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
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },

  itemSub: {
    color: MUTED,
    fontSize: 11,
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
    borderRadius: 999,
    alignItems: "center",
  },

  logoutText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 14,
  },
});
