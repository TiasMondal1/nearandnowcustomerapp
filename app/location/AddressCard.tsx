import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";

import { C } from "../../constants/colors";

type Props = {
  id: string;
  label: string;
  address: string;
  isDefault?: boolean;
  onSelect?: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

function AddressCard({
  label,
  address,
  isDefault,
  onSelect,
  onEdit,
  onDelete,
}: Props) {
  return (
    <Swipeable
      renderLeftActions={() => (
        <Action color="#2ecc71" icon="pencil" label="Edit" onPress={onEdit} />
      )}
      renderRightActions={() => (
        <Action
          color="#e74c3c"
          icon="trash-can"
          label="Delete"
          onPress={onDelete}
        />
      )}
    >
      {/* 👇 TAP AREA (this fixes selection) */}
      <Pressable
        onPress={onSelect}
        android_ripple={{ color: C.bgSoft }}
        style={({ pressed }) => [
          styles.card,
          pressed && { opacity: 0.88 },
          isDefault && styles.defaultCard,
        ]}
      >
        <View style={styles.row}>
          <View style={styles.labelRow}>
            <MaterialCommunityIcons
              name={label === "Home" ? "home-outline" : label === "Work" ? "briefcase-outline" : "map-marker-outline"}
              size={16}
              color={isDefault ? C.primary : C.textSub}
            />
            <Text style={[styles.label, isDefault && { color: C.primary }]}>{label}</Text>
          </View>
          {isDefault && (
            <View style={styles.defaultBadge}>
              <Text style={styles.defaultBadgeText}>DEFAULT</Text>
            </View>
          )}
        </View>
        <Text style={styles.address} numberOfLines={2}>{address}</Text>
      </Pressable>
    </Swipeable>
  );
}

function Action({
  color,
  icon,
  label,
  onPress,
}: {
  color: string;
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.action, { backgroundColor: color }]}
    >
      <MaterialCommunityIcons name={icon as any} size={22} color="#fff" />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

export default memo(AddressCard);

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  defaultCard: {
    borderColor: C.primary,
    borderWidth: 1.5,
    backgroundColor: C.primaryXLight,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { color: C.text, fontSize: 15, fontWeight: "700" },
  defaultBadge: {
    backgroundColor: C.primaryXLight,
    borderWidth: 1,
    borderColor: C.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  defaultBadgeText: { fontSize: 10, color: C.primary, fontWeight: "800" },
  address: { color: C.textSub, fontSize: 13, lineHeight: 19 },

  action: {
    width: 80,
    justifyContent: "center",
    alignItems: "center",
    marginVertical: 6,
    borderRadius: 12,
  },
  actionText: { color: "#fff", fontSize: 12, marginTop: 4, fontWeight: "600" },
});
