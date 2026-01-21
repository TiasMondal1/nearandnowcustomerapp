import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCart } from "../cart/CartContext";

const API_BASE = "http://192.168.1.117:3001";
const { width } = Dimensions.get("window");


const COLORS = {
  bg: "#05030A",
  card: "#140F2D",
  soft: "#1B1440",
  border: "#2F245A",
  primary: "#7A66D9",
  green: "#7CFF6B",
  text: "#FFFFFF",
  muted: "#9C94D7",
  placeholder: "#1f1a3a",
};

export default function ProductDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { addItem, items, updateQty } = useCart();

  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<any>(null);
  const [details, setDetails] = useState<any>(null);
  const [images, setImages] = useState<string[]>([]);

  const cartItem = items.find((i) => i.product_id === product?.id);


  useEffect(() => {
    fetchProduct();
  }, [id]);

  const fetchProduct = async () => {
    try {
      setLoading(true);

      const res = await fetch(`${API_BASE}/product/${id}`);
      const json = await res.json();

      if (!json?.success) {
        setProduct(null);
        return;
      }

      setProduct(json.product);
      setDetails(json.details || null);

      const cover = json.product?.image_url
        ? [json.product.image_url]
        : [];

      const gallery =
        json.images?.map((i: any) => i.image_url) || [];

      setImages([...cover, ...gallery]);
    } catch (e) {
      console.error("❌ PRODUCT FETCH ERROR", e);
      setProduct(null);
    } finally {
      setLoading(false);
    }
  };

 

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </SafeAreaView>
    );
  }

  if (!product) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={{ color: COLORS.text }}>Product not found</Text>
      </SafeAreaView>
    );
  }



  return (
    <SafeAreaView style={styles.safe}>
     
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>

        <Text style={styles.headerTitle} numberOfLines={1}>
          {product.name}
        </Text>
      </View>

     
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 180 }}
      >
        {/* IMAGE CAROUSEL */}
        <View style={styles.imageWrap}>
          <FlatList
            data={images}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(i, idx) => `${i}-${idx}`}
            renderItem={({ item }) =>
              item ? (
                <Image source={{ uri: item }} style={styles.heroImage} />
              ) : (
                <View
                  style={[
                    styles.heroImage,
                    { backgroundColor: COLORS.placeholder },
                  ]}
                />
              )
            }
          />
        </View>

        {/* DETAILS CARD */}
        <View style={styles.detailsCard}>
          <Text style={styles.name}>{product.name}</Text>

          {/* PRICE */}
          <View style={styles.priceRow}>
            <MaterialCommunityIcons
              name="currency-inr"
              size={18}
              color={COLORS.green}
            />
            <Text style={styles.price}>{product.price}</Text>
            <Text style={styles.unit}> / {product.unit}</Text>
          </View>

          {/* DESCRIPTION */}
          {details?.description && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About this product</Text>
              <Text style={styles.desc}>{details.description}</Text>
            </View>
          )}

          {/* HIGHLIGHTS */}
          {details?.highlights?.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Highlights</Text>
              <View style={styles.highlightBox}>
                {details.highlights.map((h: string, i: number) => (
                  <Text key={i} style={styles.highlight}>
                    • {h}
                  </Text>
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* FLOATING CART BAR */}
      <View style={styles.bottomBar}>
        {!cartItem ? (
          <TouchableOpacity
            activeOpacity={0.9}
            style={styles.addBtn}
            onPress={() =>
              addItem({
                product_id: product.id,
                store_id: product.store_id,
                name: product.name,
                price: product.price,
                unit: product.unit,
                image_url: product.image_url,
              })
            }
          >
            <Text style={styles.addText}>ADD TO CART</Text>
            <MaterialCommunityIcons name="plus" size={20} color="#fff" />
          </TouchableOpacity>
        ) : (
          <View style={styles.qtyContainer}>
            <TouchableOpacity
              style={styles.qtyBtn}
              onPress={() =>
                updateQty(cartItem.product_id, cartItem.quantity - 1)
              }
            >
              <Text style={styles.qtyText}>−</Text>
            </TouchableOpacity>

            <View style={styles.qtyBubble}>
              <Text style={styles.qty}>{cartItem.quantity}</Text>
            </View>

            <TouchableOpacity
              style={styles.qtyBtn}
              onPress={() =>
                updateQty(cartItem.product_id, cartItem.quantity + 1)
              }
            >
              <Text style={styles.qtyText}>+</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

/* ─────────── STYLES ─────────── */

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  center: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: "center",
    justifyContent: "center",
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },

  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.soft,
    alignItems: "center",
    justifyContent: "center",
  },

  headerTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: "700",
    flex: 1,
  },

  imageWrap: {
    backgroundColor: COLORS.card,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: "hidden",
  },

  heroImage: {
    width,
    height: 300,
    resizeMode: "contain",
  },

  detailsCard: {
    marginTop: -24,
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
  },

  name: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: "800",
  },

  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  },

  price: {
    color: COLORS.green,
    fontSize: 28,
    fontWeight: "800",
  },

  unit: {
    color: COLORS.muted,
    fontSize: 13,
  },

  section: {
    marginTop: 22,
  },

  sectionTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 6,
  },

  desc: {
    color: "#C4BDEA",
    fontSize: 14,
    lineHeight: 20,
  },

  highlightBox: {
    backgroundColor: COLORS.soft,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },

  highlight: {
    color: COLORS.text,
    fontSize: 13,
  },

  bottomBar: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
    backgroundColor: COLORS.card,
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
    elevation: 10,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },

  addBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 999,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  addText: {
    color: "#fff",
    fontWeight: "800",
    letterSpacing: 0.6,
  },

  qtyContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },

  qtyBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.soft,
    alignItems: "center",
    justifyContent: "center",
  },

  qtyText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
  },

  qtyBubble: {
    minWidth: 44,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: "center",
  },

  qty: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
  },
});
