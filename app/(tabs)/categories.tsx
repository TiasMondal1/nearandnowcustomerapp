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

import { C } from "../../constants/colors";
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
    getCategoryCounts,
    getCountForCategoryName,
    readHomePageCache,
    writeHomePageCache,
} from "../../lib/productService";

const FALLBACK_TILE_COLORS = [
  "#E6F4EA", "#FEF3C7", "#DBEAFE", "#FCE7F3",
  "#EDE9FE", "#D1FAE5", "#FFE4E6", "#FEF9C3",
];

const FALLBACK_ICONS = [
  "apple",
  "leaf",
  "cow",
  "cookie",
  "cup",
  "sack",
  "face-woman-shimmer",
  "home-outline",
];

type CategoryWithTint = Category & { tint: string; iconName: string };

type Section = {
  group: CategoryGroupDef;
  items: CategoryWithTint[];
};

/**
 * One tile — memoized so scrolling a large grouped grid doesn't re-render
 * every tile when the header re-renders.
 */
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
        pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 },
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
            size={34}
            color={C.primary}
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

  /**
   * Build Blinkit-style sections: buckets categories into their logical group
   * ("Grocery & Kitchen", "Snacks & Drinks", etc) while dropping groups that
   * have zero live categories — keeps the screen compact on sparse catalogs.
   */
  const sections = useMemo<Section[]>(() => {
    const byGroupId = new Map<string, CategoryWithTint[]>();
    let tintIdx = 0;

    for (const cat of categories) {
      if (getCountForCategoryName(categoryCounts, cat.name) <= 0) continue;

      const group = getGroupForCategoryName(cat.name);
      const enriched: CategoryWithTint = {
        ...cat,
        tint:
          cat.color ||
          FALLBACK_TILE_COLORS[tintIdx++ % FALLBACK_TILE_COLORS.length],
        iconName:
          cat.icon ||
          FALLBACK_ICONS[Math.abs(cat.name.length) % FALLBACK_ICONS.length],
      };

      const list = byGroupId.get(group.id);
      if (list) {
        list.push(enriched);
      } else {
        byGroupId.set(group.id, [enriched]);
      }
    }

    const out: Section[] = [];
    for (const g of CATEGORY_GROUPS) {
      const items = byGroupId.get(g.id);
      if (items && items.length) out.push({ group: g, items });
    }
    const rest = byGroupId.get(DEFAULT_GROUP.id);
    if (rest && rest.length) out.push({ group: DEFAULT_GROUP, items: rest });
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
          <Text style={styles.title}>Shop by category</Text>
          <Text style={styles.subtitle}>Fresh groceries delivered fast</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.loadingText}>Loading categories…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Shop by category</Text>
        <Text style={styles.subtitle}>Fresh groceries delivered fast</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
      >
        {sections.length === 0 ? (
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons
              name="view-grid-outline"
              size={64}
              color={C.textLight}
            />
            <Text style={styles.emptyTitle}>No categories available</Text>
            <Text style={styles.emptyText}>Check back soon for new categories</Text>
          </View>
        ) : (
          sections.map(({ group, items }) => (
            <View key={group.id} style={styles.sectionWrap}>
              <Text style={styles.sectionTitle}>{group.title}</Text>
              <View style={styles.grid}>
                {items.map((it) => (
                  <CategoryTile
                    key={it.id}
                    item={it}
                    onPress={handleTilePress}
                  />
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
  safe: {
    flex: 1,
    backgroundColor: C.bg,
  },

  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSoft,
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

  scrollContent: {
    paddingBottom: 130,
    paddingTop: 8,
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

  sectionWrap: {
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 4,
  },
  sectionTitle: {
    fontSize: 17,
    color: C.text,
    fontWeight: "900",
    letterSpacing: -0.2,
    paddingHorizontal: 4,
    marginBottom: 10,
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },

  tile: {
    width: "25%",
    paddingHorizontal: 4,
    paddingVertical: 6,
    alignItems: "center",
  },
  tileImageWrap: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  tileImage: { width: "100%", height: "100%" },
  tileLabel: {
    marginTop: 6,
    fontSize: 11.5,
    color: C.text,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 14,
  },
});
