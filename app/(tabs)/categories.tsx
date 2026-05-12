import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
    CATEGORY_GROUPS,
    DEFAULT_GROUP,
    getGroupForCategoryName,
    type CategoryGroupDef,
} from "../../constants/categoryGroups";
import { useLocation } from "../../context/LocationContext";
import { getAllCategories, type Category } from "../../lib/categoryService";
import { cdnImage } from "../../lib/imageUrl";
import {
    getCountForCategoryName,
    readHomeCatalogCache,
} from "../../lib/productService";
import { getAllActiveProductIds } from "../../lib/storeService";

const T = {
  green: "#2D7A4F",
  greenXLight: "#EAF6EE",
  cream: "#FAFAF7",
  bark: "#3C2F1E",
  barkMid: "#6B5744",
  barkLight: "#A89282",
  white: "#FFFFFF",
  card: "#FFFFFF",
  cardBorder: "rgba(60,47,30,0.08)",
  shadow: "rgba(0,0,0,0.08)",
};

const CAT_TINTS = [
  "#E8F5E9", "#FFF8E1", "#E3F2FD", "#FCE4EC",
  "#EDE7F6", "#E0F7FA", "#FBE9E7", "#F9FBE7",
];

const FALLBACK_ICONS = [
  "apple", "leaf", "cow", "cookie",
  "cup", "sack", "face-woman-shimmer", "home-outline",
];

type CategoryWithTint = Category & { tint: string; iconName: string };
type Section = { group: CategoryGroupDef; items: CategoryWithTint[] };

const CategoryTile = React.memo(function CategoryTile({
  item,
  onPress,
}: {
  item: CategoryWithTint;
  onPress: (slug: string) => void;
}) {
  const handlePress = useCallback(() => onPress(item.slug), [onPress, item.slug]);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.tile,
        pressed && { transform: [{ scale: 0.96 }], opacity: 0.88 },
      ]}
    >
      <View style={[styles.tileImageWrap, { backgroundColor: item.tint }]}>
        {item.image_url ? (
          <Image
            source={{ uri: cdnImage(item.image_url, 240) }}
            style={styles.tileImage}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={120}
            recyclingKey={item.id}
            priority="low"
          />
        ) : (
          <MaterialCommunityIcons
            name={item.iconName as any}
            size={32}
            color={T.green}
          />
        )}
      </View>
      <Text style={styles.tileLabel} numberOfLines={2}>
        {item.name}
      </Text>
    </Pressable>
  );
});

export default function CategoriesScreen() {
  const { isHydrated } = useLocation();
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const buildCountsFromProductsByCategory = useCallback(
    (productsByCategory: Record<string, unknown[]>) => {
      const counts: Record<string, number> = {};
      for (const [cat, prods] of Object.entries(productsByCategory)) {
        counts[cat.toLowerCase().trim()] = prods.length;
      }
      return counts;
    },
    [],
  );

  const fetchData = useCallback(async (_isRefresh = false) => {
    try {
      // Try home catalog cache first — it's already filtered to active store products
      const [cached, categoriesData] = await Promise.all([
        readHomeCatalogCache(),
        getAllCategories(),
      ]);

      setCategories(categoriesData);

      if (cached?.productsByCategory) {
        setCategoryCounts(buildCountsFromProductsByCategory(cached.productsByCategory as Record<string, unknown[]>));
      } else {
        // No cache yet — build counts from active product IDs
        const activeIds = await getAllActiveProductIds();
        // Use active IDs to count per category via a lightweight query
        const { data } = await import("../../lib/supabase").then(async ({ supabase }) =>
          supabase
            .from("master_products")
            .select("category")
            .eq("is_active", true)
            .in("id", [...activeIds].slice(0, 5000)),
        );
        if (data) {
          const counts: Record<string, number> = {};
          for (const row of data as { category: string | null }[]) {
            const key = (row.category || "Uncategorized").toLowerCase().trim();
            counts[key] = (counts[key] || 0) + 1;
          }
          setCategoryCounts(counts);
        }
      }
    } catch (error) {
      console.error("Failed to fetch categories:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [buildCountsFromProductsByCategory]);

  // Paint from home catalog cache immediately
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cached, categoriesData] = await Promise.all([
        readHomeCatalogCache(),
        getAllCategories(),
      ]);
      if (cancelled) return;
      if (cached?.productsByCategory) {
        setCategories(categoriesData);
        setCategoryCounts(buildCountsFromProductsByCategory(cached.productsByCategory as Record<string, unknown[]>));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [buildCountsFromProductsByCategory]);

  useEffect(() => {
    if (!isHydrated) return;
    fetchData();
  }, [isHydrated, fetchData]);

  const sections = useMemo<Section[]>(() => {
    const byGroupId = new Map<string, CategoryWithTint[]>();
    let tintIdx = 0;

    for (const cat of categories) {
      if (getCountForCategoryName(categoryCounts, cat.name) <= 0) continue;

      const group = getGroupForCategoryName(cat.name);
      const enriched: CategoryWithTint = {
        ...cat,
        tint: cat.color || CAT_TINTS[tintIdx++ % CAT_TINTS.length],
        iconName: cat.icon || FALLBACK_ICONS[Math.abs(cat.name.length) % FALLBACK_ICONS.length],
      };

      const list = byGroupId.get(group.id);
      if (list) list.push(enriched);
      else byGroupId.set(group.id, [enriched]);
    }

    const out: Section[] = [];
    for (const g of CATEGORY_GROUPS) {
      const items = byGroupId.get(g.id);
      if (items?.length) out.push({ group: g, items });
    }
    const rest = byGroupId.get(DEFAULT_GROUP.id);
    if (rest?.length) out.push({ group: DEFAULT_GROUP, items: rest });
    return out;
  }, [categories, categoryCounts]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData(true);
  }, [fetchData]);

  const handleTilePress = useCallback((slug: string) => {
    router.push(`/category/${slug}` as any);
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <View style={styles.headerAccent} />
          <View>
            <Text style={styles.title}>Categories</Text>
            <Text style={styles.subtitle}>Browse everything we carry</Text>
          </View>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={T.green} />
          <Text style={styles.loadingText}>Loading categories…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.headerAccent} />
        <View>
          <Text style={styles.title}>Categories</Text>
          <Text style={styles.subtitle}>Browse everything we carry</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={T.green}
            colors={[T.green]}
          />
        }
      >
        {sections.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <MaterialCommunityIcons name="view-grid-outline" size={40} color={T.green} />
            </View>
            <Text style={styles.emptyTitle}>No categories yet</Text>
            <Text style={styles.emptyText}>Check back soon for new categories</Text>
          </View>
        ) : (
          sections.map(({ group, items }) => (
            <View key={group.id} style={styles.sectionWrap}>
              <View style={styles.sectionTitleRow}>
                <View style={styles.sectionTitleAccent} />
                <Text style={styles.sectionTitle}>{group.title}</Text>
              </View>
              <View style={styles.grid}>
                {items.map((it) => (
                  <CategoryTile key={it.id} item={it} onPress={handleTilePress} />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.cream },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12,
    backgroundColor: T.white,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
  },
  headerAccent: {
    width: 4,
    height: 26,
    borderRadius: 2,
    backgroundColor: T.green,
  },
  title: {
    fontSize: 22,
    fontWeight: "900",
    color: T.bark,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 12,
    color: T.barkLight,
    fontWeight: "500",
    marginTop: 2,
  },

  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: T.barkLight, fontSize: 14, fontWeight: "500" },

  scrollContent: { paddingBottom: 130, paddingTop: 4 },

  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 12,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: T.greenXLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(45,122,79,0.15)",
  },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: T.bark },
  emptyText: { fontSize: 14, color: T.barkLight, fontWeight: "500" },

  sectionWrap: {
    paddingHorizontal: 14,
    paddingTop: 20,
    paddingBottom: 4,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  sectionTitleAccent: {
    width: 4,
    height: 18,
    borderRadius: 2,
    backgroundColor: T.green,
  },
  sectionTitle: {
    fontSize: 17,
    color: T.bark,
    fontWeight: "900",
    letterSpacing: -0.3,
  },

  grid: { flexDirection: "row", flexWrap: "wrap" },

  tile: {
    width: "25%",
    paddingHorizontal: 5,
    paddingVertical: 6,
    alignItems: "center",
    gap: 6,
  },
  tileImageWrap: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: T.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  tileImage: { width: "100%", height: "100%" },
  tileLabel: {
    fontSize: 11.5,
    color: T.bark,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 14,
  },
});
