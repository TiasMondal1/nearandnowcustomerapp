import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";

const PRIMARY = "#765fba";
const CARD = "#120D24";

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
        android_ripple={{ color: "#2A224A" }}
        style={({ pressed }) => [
          styles.card,
          pressed && { opacity: 0.85 },
          isDefault && styles.defaultCard,
        ]}
      >
        <View style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          {isDefault && <Text style={styles.badge}>DEFAULT</Text>}
        </View>

        <Text style={styles.address} numberOfLines={2}>
          {address}
        </Text>
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
    backgroundColor: CARD,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
  },

  defaultCard: {
    borderWidth: 1,
    borderColor: PRIMARY,
  },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  label: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },

  badge: {
    fontSize: 11,
    color: PRIMARY,
    fontWeight: "700",
    borderWidth: 1,
    borderColor: PRIMARY,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },

  address: {
    color: "#C4BDEA",
    fontSize: 14,
    marginTop: 6,
    lineHeight: 20,
  },

  action: {
    width: 86,
    justifyContent: "center",
    alignItems: "center",
    marginVertical: 6,
    borderRadius: 16,
  },

  actionText: {
    color: "#fff",
    fontSize: 12,
    marginTop: 4,
    fontWeight: "600",
  },
});
