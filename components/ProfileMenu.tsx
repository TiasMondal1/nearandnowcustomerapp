import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
    Alert,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import { C } from "../constants/colors";
import { useAuth } from "../context/AuthContext";

interface ProfileMenuProps {
  visible: boolean;
  onClose: () => void;
}

export default function ProfileMenu({ visible, onClose }: ProfileMenuProps) {
  const { user, logoutUser } = useAuth();

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          await logoutUser();
          onClose();
          router.replace("/phone");
        },
      },
    ]);
  };

  const handleNavigation = (path: string) => {
    onClose();
    router.push(path as any);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.menuCard} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Profile</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <MaterialCommunityIcons name="close" size={24} color={C.text} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.profileCard}>
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarText}>
                  {user?.name?.charAt(0)?.toUpperCase() ?? "?"}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{user?.name ?? "Guest"}</Text>
                {user?.phone ? <Text style={styles.sub}>{user.phone}</Text> : null}
                {user?.email ? <Text style={styles.sub}>{user.email}</Text> : null}
              </View>
            </View>

            <View style={styles.section}>
              <MenuItem
                icon="pencil-outline"
                title="Edit Profile"
                subtitle="Update your information"
                onPress={() => handleNavigation("/settings/profile")}
              />
              <MenuItem
                icon="repeat"
                title="Previous Orders"
                subtitle="View order history"
                onPress={() => handleNavigation("/orders")}
              />
              <MenuItem
                icon="map-marker-outline"
                title="Address Book"
                subtitle="Manage delivery locations"
                onPress={() => handleNavigation("/location")}
              />
              <MenuItem
                icon="wallet-outline"
                title="Payment Settings"
                subtitle="UPI, cards & refunds"
                onPress={() => handleNavigation("/settings/payments")}
              />
              <MenuItem
                icon="bell-outline"
                title="Notifications"
                subtitle="Order & promo alerts"
                onPress={() => {
                  onClose();
                  Alert.alert("Coming Soon", "Push notifications will be available soon.");
                }}
              />
              <MenuItem
                icon="help-circle-outline"
                title="Help & Support"
                subtitle="FAQs & contact support"
                onPress={() => handleNavigation("/settings/support")}
              />
              <MenuItem
                icon="file-document-outline"
                title="Terms & Privacy"
                subtitle="Legal information"
                onPress={() => handleNavigation("/settings/terms")}
                isLast
              />
            </View>

            <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
              <MaterialCommunityIcons name="logout" size={20} color={C.danger} />
              <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>

            <View style={styles.footer}>
              <Text style={styles.footerBrand}>Near & Now</Text>
              <Text style={styles.footerTagline}>Digital Dukaan, local dil se</Text>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MenuItem({
  icon,
  title,
  subtitle,
  onPress,
  isLast,
}: {
  icon: any;
  title: string;
  subtitle: string;
  onPress: () => void;
  isLast?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.menuItem, !isLast && styles.menuItemBorder]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.menuIconWrap}>
        <MaterialCommunityIcons name={icon} size={22} color={C.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuSubtitle}>{subtitle}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={C.textLight} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  menuCard: {
    backgroundColor: C.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "85%",
    paddingBottom: 40,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: C.text,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  profileCard: {
    backgroundColor: C.bgSoft,
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
    margin: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  avatarFallback: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: C.primary,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  avatarText: { color: "#fff", fontSize: 24, fontWeight: "900" },
  name: { color: C.text, fontSize: 17, fontWeight: "800" },
  sub: { color: C.textSub, fontSize: 13, marginTop: 2 },
  section: {
    backgroundColor: C.card,
    borderRadius: 16,
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 3,
  },
  menuItem: {
    flexDirection: "row",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    alignItems: "center",
  },
  menuItemBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  menuIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.primaryXLight,
    alignItems: "center",
    justifyContent: "center",
  },
  menuTitle: { color: C.text, fontSize: 15, fontWeight: "700" },
  menuSubtitle: { color: C.textSub, fontSize: 13, marginTop: 2 },
  logoutBtn: {
    flexDirection: "row",
    gap: 10,
    marginHorizontal: 20,
    marginTop: 24,
    paddingVertical: 16,
    paddingHorizontal: 24,
    backgroundColor: C.dangerLight,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#fca5a5",
    shadowColor: C.danger,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  logoutText: { color: C.danger, fontWeight: "800", fontSize: 15 },
  footer: {
    marginTop: 28,
    marginBottom: 24,
    alignItems: "center",
    paddingHorizontal: 20,
  },
  footerBrand: { fontSize: 16, fontWeight: "800", color: C.primary },
  footerTagline: { fontSize: 12, color: C.textSub, marginTop: 4 },
});
