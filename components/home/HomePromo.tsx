// HomePromo — the two wide photo cards that break up Home's lower feed. Both are neutral browsing prompts (no offer,
// price or promise) and both open a route that already exists. The press is navigation and therefore silent.
// Handlers and copy are module-level, so the only prop is the id and the card never re-renders.
import { router } from "expo-router";
import React from "react";
import { StyleSheet, View } from "react-native";

import { layout } from "../../constants/ui";
import type { PhotoSlot } from "../brand";
import { PhotoCard } from "../cards";

export type HomePromoId = "search" | "aisles";

function openSearch(): void {
  router.push("/support/search");
}

function openCategories(): void {
  router.push("/(tabs)/categories");
}

const PROMOS: Record<HomePromoId, { slot: PhotoSlot; title: string; subtitle: string; cta: string; onPress: () => void }> = {
  search: {
    slot: "promoSearch",
    title: "Looking for something else?",
    subtitle: "Search every shop near you",
    cta: "Search",
    onPress: openSearch,
  },
  aisles: {
    slot: "promoAisles",
    title: "Browse every aisle",
    subtitle: "All categories from shops near you",
    cta: "All categories",
    onPress: openCategories,
  },
};

/** The photo slot behind a promo; the screen adds the row only when `hasPhoto` is true for it. */
export const HOME_PROMO_SLOT: Record<HomePromoId, PhotoSlot> = { search: PROMOS.search.slot, aisles: PROMOS.aisles.slot };

function HomePromoBase({ id }: { id: HomePromoId }) {
  const promo = PROMOS[id];
  return (
    <View style={styles.root}>
      <PhotoCard
        slot={promo.slot}
        title={promo.title}
        subtitle={promo.subtitle}
        cta={promo.cta}
        onPress={promo.onPress}
        testID={`home-promo-${id}`}
      />
    </View>
  );
}

export const HomePromo = React.memo(HomePromoBase);
HomePromo.displayName = "HomePromo";

const styles = StyleSheet.create({
  root: { paddingHorizontal: layout.gutter, marginTop: 16, marginBottom: 4 },
});
