import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../../constants/colors";
import { useLocation } from "../../context/LocationContext";
import { getAllCategories, type Category } from "../../lib/categoryService";
import { cdnImage } from "../../lib/imageUrl";
import {
    getCategoryCounts,
    getCountForCategoryName,
    readHomePageCache,
    writeHomePageCache,
} from "../../lib/productService";

const FALLBACK_COLORS = [
  "#FF6B6B", "#51CF66", "#FFD43B", "#845EF7",
  "#339AF0", "#FAB005", "#E599F7", "#74C0FC"
];

const FALLBACK_ICONS = [
  "apple", "leaf", "cow", "cookie",
  "cup", "sack", "face-woman-shimmer", "home-outline"
];

export default function CategoriesScreen() {
  const { isHydrated } = useLocation();
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (_isRefresh = false) => {
    try {
      const [categoriesData, countsData] = await Promise.all([
        getAllCategories(),
        getCategoryCounts(),
      ]);
      setCategories(categoriesData);
      setCategoryCounts(countsData.counts);
      writeHomePageCache({
        categories: categoriesData,
        categoryCounts: countsData,
        firstPage: [],
      });
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Paint from cache ASAP.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await readHomePageCache();
      if (cancelled || !cached) return;
      setCategories(cached.categories);
      setCategoryCounts(cached.categoryCounts.counts);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    fetchData();
  }, [isHydrated, fetchData]);

  const categoriesWithProducts = useMemo(
    () =>
      categories.filter((c) => getCountForCategoryName(categoryCounts, c.name) > 0),
    [categories, categoryCounts],
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData(true);
  }, [fetchData]);


  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.title}>Shop by category</Text>
          <Text style={styles.subtitle}>Fresh groceries delivered fast</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.loadingText}>Loading categories...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Shop by category</Text>
        <Text style={styles.subtitle}>Fresh groceries delivered fast</Text>
      </View>

      <FlatList
        data={categoriesWithProducts}
        numColumns={2}
        keyExtractor={(item) => item.id}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons name="view-grid-outline" size={64} color={C.textLight} />
            <Text style={styles.emptyTitle}>No categories available</Text>
            <Text style={styles.emptyText}>Check back soon for new categories</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const color = item.color || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
          const icon = item.icon || FALLBACK_ICONS[index % FALLBACK_ICONS.length];

          return (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => router.push(`/category/${item.slug}`)}
              style={styles.tileWrap}
            >
              <LinearGradient
                colors={[color + "33", color + "11", "transparent"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.tile}
              >
                {item.image_url ? (
                  <Image
                    source={{ uri: cdnImage(item.image_url) }}
                    style={styles.categoryImage}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={120}
                    recyclingKey={item.id}
                  />
                ) : (
                  <View
                    style={[
                      styles.iconBubble,
                      { backgroundColor: color + "22" },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={icon as any}
                      size={34}
                      color={color}
                    />
                  </View>
                )}

                <Text style={styles.label}>{item.name}</Text>

                <View style={styles.ctaRow}>
                  <MaterialCommunityIcons
                    name="arrow-right"
                    size={14}
                    color={C.textSub}
                  />
                </View>
              </LinearGradient>
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: C.bg,
  },

  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
  },

  title: {
    color: C.text,
    fontSize: 22,
    fontWeight: "900",
  },

  subtitle: {
    color: C.textSub,
    fontSize: 13,
    marginTop: 4,
  },

  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },

  loadingText: {
    color: C.textSub,
    fontSize: 14,
  },

  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 12,
  },

  emptyTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: "800",
  },

  emptyText: {
    color: C.textSub,
    fontSize: 14,
  },

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
    borderRadius: 16,
    padding: 16,
    minHeight: 140,
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4,
  },

  categoryImage: {
    width: 56,
    height: 56,
    borderRadius: 18,
  },

  iconBubble: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },

  label: {
    color: C.text,
    fontSize: 15,
    fontWeight: "800",
    marginTop: 14,
  },

  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    gap: 6,
  },

  ctaText: {
    color: C.textSub,
    fontSize: 12,
    fontWeight: "700",
  },
});
