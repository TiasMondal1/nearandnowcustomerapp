import { router } from "expo-router";
import React from "react";
import {
    Alert,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { C } from "../constants/colors";
import { radius, shadow } from "../constants/ui";
import { useAuth } from "../context/AuthContext";
import { Card, IconButton, ListRow, PrimaryButton, type IconName } from "./ui";

interface ProfileMenuProps {
  visible: boolean;
  onClose: () => void;
}

export default function ProfileMenu({ visible, onClose }: ProfileMenuProps) {
  const { user, logoutUser } = useAuth();
  const insets = useSafeAreaInsets();

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
      <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Close menu">
        <Pressable
          style={[styles.menuCard, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Profile</Text>
            <IconButton
              icon="close"
              iconSize={24}
              size={40}
              shape="circle"
              accessibilityLabel="Close menu"
              onPress={onClose}
            />
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Card size="lg" bg={C.bgSoft} style={styles.profileCard}>
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarText}>
                  {user?.name?.charAt(0)?.toUpperCase() ?? "?"}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{user?.name ?? "Guest"}</Text>
                {user?.phone ? <Text style={styles.sub} numberOfLines={1}>{user.phone}</Text> : null}
                {user?.email ? (
                  <Text style={styles.sub} numberOfLines={1} ellipsizeMode="middle">{user.email}</Text>
                ) : null}
              </View>
            </Card>

            <Card size="lg" padded={false} style={styles.section}>
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
                onPress={() => handleNavigation("/notifications")}
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
            </Card>

            <PrimaryButton
              variant="danger"
              icon="logout"
              label="Logout"
              onPress={handleLogout}
              style={styles.logoutBtn}
              textStyle={styles.logoutText}
            />

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
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  isLast?: boolean;
}) {
  return (
    <ListRow
      size="lg"
      icon={icon}
      title={title}
      subtitle={subtitle}
      onPress={onPress}
      divider={!isLast}
      activeOpacity={0.7}
    />
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
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    maxHeight: "85%",
    ...shadow.sheet,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    marginTop: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: "PlusJakartaSans_800ExtraBold",
    color: C.text,
  },
  profileCard: {
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 16,
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
  avatarText: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.card, fontSize: 24 },
  name: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text, fontSize: 17 },
  sub: { fontFamily: "PlusJakartaSans_400Regular", color: C.textSub, fontSize: 13, marginTop: 2 },
  section: { marginHorizontal: 16 },
  logoutBtn: {
    marginHorizontal: 16,
    marginTop: 24,
    paddingVertical: 16,
  },
  logoutText: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 15 },
  footer: {
    marginTop: 28,
    marginBottom: 24,
    alignItems: "center",
    paddingHorizontal: 16,
  },
  footerBrand: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 16, color: C.primary },
  footerTagline: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 12, color: C.textSub, marginTop: 4 },
});
