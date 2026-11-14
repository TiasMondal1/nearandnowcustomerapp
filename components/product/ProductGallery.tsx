/**
 * Product page hero: the product's photos, swiped sideways, with page dots.
 *
 * `images` is `productGallery(product)` — the main image (master_products.image_url), then the extra photos
 * (master_products.additional_images, 2026-11-15). With one photo it renders exactly the single hero image the page
 * always had (same Image props, so the warm cache from ProductCard's press-in prefetch still hits); the pager only
 * appears when there is more than one. The page keeps its own no-image placeholder and deal badge.
 */
import { Image } from "expo-image";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  StyleSheet,
  View,
  type ImageStyle,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
} from "react-native";

import { C } from "../../constants/colors";
import { motion } from "../../constants/ui";
import { cdnImage } from "../../lib/imageUrl";

type Props = {
  images: readonly string[];
  /** cdnImage width hint — the page's HERO_IMAGE_WIDTH, shared with ProductCard's prefetch. */
  widthHint: number;
  productName: string;
  /** product.id: keeps expo-image from showing the previous product's pixels while the next loads. */
  recyclingKey: string;
  /** Where the photo sits inside the hero (the page's inset style, with room for the dots below). */
  imageStyle: StyleProp<ImageStyle>;
};

function ProductGalleryImpl({ images, widthHint, productName, recyclingKey, imageStyle }: Props) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<string>>(null);
  const count = images.length;

  // A different product (or a shorter list after a refresh) starts from the first photo.
  useEffect(() => {
    setIndex(0);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [recyclingKey]);
  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  const pageWidth = size?.width ?? 0;
  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (pageWidth <= 0) return;
      const next = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
      setIndex(Math.max(0, Math.min(count - 1, next)));
    },
    [pageWidth, count],
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<string> | null | undefined, i: number) => ({ length: pageWidth, offset: pageWidth * i, index: i }),
    [pageWidth],
  );

  const renderItem = useCallback(
    ({ item, index: i }: ListRenderItemInfo<string>) => (
      <View style={size ? { width: size.width, height: size.height } : undefined}>
        <Image
          source={{ uri: cdnImage(item, widthHint) }}
          style={imageStyle}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={motion.imageFade}
          priority={i === 0 ? "high" : "normal"}
          recyclingKey={`${recyclingKey}:${i}`}
          accessible
          accessibilityLabel={`${productName}, photo ${i + 1} of ${count}`}
          alt={`${productName}, photo ${i + 1} of ${count}`}
          accessibilityIgnoresInvertColors
        />
      </View>
    ),
    [size, widthHint, imageStyle, recyclingKey, productName, count],
  );

  if (count === 0) return null;

  // One photo, or the hero not measured yet: the page's original single image.
  if (count === 1 || !size) {
    return (
      <View style={StyleSheet.absoluteFill} onLayout={onLayout}>
        <Image
          source={{ uri: cdnImage(images[0], widthHint) }}
          style={imageStyle}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={motion.imageFade}
          priority="high"
          recyclingKey={recyclingKey}
          accessible
          accessibilityLabel={productName}
          alt={productName}
          accessibilityIgnoresInvertColors
        />
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout}>
      <FlatList
        ref={listRef}
        data={images as string[]}
        keyExtractor={(uri, i) => `${i}:${uri}`}
        renderItem={renderItem}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        getItemLayout={getItemLayout}
        // The visible photo plus its neighbours, so the next one is already loading when the swipe starts.
        initialNumToRender={2}
        windowSize={3}
        maxToRenderPerBatch={2}
        // The page's vertical ScrollView keeps vertical drags; this list only takes sideways ones.
        nestedScrollEnabled
      />
      <View style={styles.dots} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {images.map((uri, i) => (
          <View key={`${i}:${uri}`} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

export const ProductGallery = memo(ProductGalleryImpl);

const DOT = 6;

const styles = StyleSheet.create({
  dots: {
    position: "absolute",
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: C.border },
  dotActive: { width: DOT * 3, backgroundColor: C.primary },
});
