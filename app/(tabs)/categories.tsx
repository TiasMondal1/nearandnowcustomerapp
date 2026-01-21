import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useMemo } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CATEGORY_CONFIG } from "../category/categoryconfig";

/* ───────── COLORS ───────── */
const BG = "#05030A";
const TEXT = "#FFFFFF";
const SUBTLE = "#9C94D7";

export default function CategoriesScreen() {
  const categories = useMemo(
    () =>
      Object.entries(CATEGORY_CONFIG).map(([slug, cfg]) => ({
        slug,
        ...cfg,
      })),
    [],
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* HEADER */}
      <View style={styles.header}>
        <Text style={styles.title}>Shop by category</Text>
        <Text style={styles.subtitle}>Fresh groceries delivered fast</Text>
      </View>

      {/* GRID */}
      <FlatList
        data={categories}
        numColumns={2}
        keyExtractor={(item) => item.slug}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => router.push(`/category/${item.slug}`)}
            style={styles.tileWrap}
          >
            <LinearGradient
              colors={[item.color + "33", item.color + "11", "transparent"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.tile}
            >
              {/* ICON */}
              <View
                style={[
                  styles.iconBubble,
                  { backgroundColor: item.color + "22" },
                ]}
              >
                <MaterialCommunityIcons
                  name={item.icon as any}
                  size={34}
                  color={item.color}
                />
              </View>

              {/* LABEL */}
              <Text style={styles.label}>{item.label}</Text>

              {/* CTA */}
              <View style={styles.ctaRow}>
                <Text style={styles.ctaText}>Browse</Text>
                <MaterialCommunityIcons
                  name="arrow-right"
                  size={14}
                  color={SUBTLE}
                />
              </View>
            </LinearGradient>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

/* ─────────────────────────────────────────────
 * STYLES
 * ───────────────────────────────────────────── */

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },

  /* HEADER */
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
  },

  title: {
    color: TEXT,
    fontSize: 22,
    fontWeight: "900",
  },

  subtitle: {
    color: SUBTLE,
    fontSize: 13,
    marginTop: 4,
  },

  /* GRID */
  grid: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 120,
  },

  row: {
    justifyContent: "space-between",
  },

  tileWrap: {
    width: "48%",
    marginBottom: 16,
  },

  tile: {
    borderRadius: 22,
    padding: 16,
    minHeight: 140,
    justifyContent: "space-between",
    backgroundColor: "#140F2D",
  },

  /* ICON */
  iconBubble: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },

  /* TEXT */
  label: {
    color: TEXT,
    fontSize: 15,
    fontWeight: "800",
    marginTop: 14,
  },

  /* CTA */
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    gap: 6,
  },

  ctaText: {
    color: SUBTLE,
    fontSize: 12,
    fontWeight: "700",
  },
});
