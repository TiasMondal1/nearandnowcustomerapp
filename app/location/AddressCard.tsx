import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";

import { Badge, IconWrap, type IconName } from "../../components/ui";
import { C } from "../../constants/colors";
import { text } from "../../constants/ui";

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
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={() => (
        <Action side="left" color="#2ecc71" icon="pencil" label="Edit" onPress={onEdit} />
      )}
      renderRightActions={() => (
        <Action
          side="right"
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
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${address}`}
        accessibilityState={{ selected: !!isDefault }}
        style={({ pressed }) => [
          styles.card,
          pressed && styles.cardPressed,
          isDefault && styles.defaultCard,
        ]}
      >
        <View style={styles.row}>
          <View style={styles.labelRow}>
            <IconWrap
              size={34}
              icon={label === "Home" ? "home-outline" : label === "Work" ? "briefcase-outline" : "map-marker-outline"}
              iconColor={isDefault ? C.primary : C.textSub}
              bg={isDefault ? C.card : C.bgSoft}
            />
            <Text style={[styles.label, isDefault && styles.labelDefault]} numberOfLines={1}>
              {label}
            </Text>
          </View>
          {isDefault && (
            <Badge
              size="sm"
              pill
              bordered
              tone="primary"
              borderColor={C.primaryLight}
              label="DEFAULT"
              style={styles.defaultBadge}
              textStyle={styles.defaultBadgeText}
            />
          )}
        </View>
        <Text style={styles.address} numberOfLines={2}>{address}</Text>
      </Pressable>
    </Swipeable>
  );
}

function Action({
  side,
  color,
  icon,
  label,
  onPress,
}: {
  side: "left" | "right";
  color: string;
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.action,
        side === "left" ? styles.actionLeft : styles.actionRight,
        { backgroundColor: color },
        pressed && styles.actionPressed,
      ]}
    >
      <MaterialCommunityIcons name={icon} size={22} color={C.card} />
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
    overflow: "hidden",
  },
  cardPressed: { opacity: 0.85 },
  defaultCard: {
    borderColor: C.primary,
    backgroundColor: C.primaryXLight,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  labelRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginRight: 8,
  },
  label: { color: C.text, fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", flexShrink: 1 },
  labelDefault: { color: C.primary },
  defaultBadge: { alignSelf: "center" },
  defaultBadgeText: { letterSpacing: 0.4 },
  address: { ...text.bodySm },

  action: {
    width: 80,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
    borderRadius: 14,
  },
  actionLeft: { marginRight: 8 },
  actionRight: { marginLeft: 8 },
  actionPressed: { opacity: 0.85 },
  actionText: { fontFamily: "PlusJakartaSans_600SemiBold", color: C.card, fontSize: 12, marginTop: 4 },
});
