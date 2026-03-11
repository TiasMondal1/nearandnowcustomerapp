import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCart } from "../../context/CartContext";

const PRIMARY = "#059669";
const BG = "#ffffff";

export default function TabLayout() {
  const { items } = useCart();
  const insets = useSafeAreaInsets();
  const cartItemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const baseHeight = 60;
  const basePaddingV = 8;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,

        tabBarStyle: {
          backgroundColor: BG,
          borderTopWidth: 1,
          borderTopColor: "#e5e7eb",
          height: baseHeight + insets.bottom,
          paddingBottom: Math.max(insets.bottom, basePaddingV),
          paddingTop: basePaddingV,
          position: "absolute",
          bottom: 0,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
          elevation: 8,
        },

        tabBarItemStyle: {
          paddingVertical: 4,
        },

        tabBarLabelStyle: {
          fontSize: 11,
          marginTop: 2,
          marginBottom: 0,
          fontWeight: "600",
        },

        tabBarIconStyle: {
          marginTop: 0,
        },

        tabBarActiveTintColor: PRIMARY,
        tabBarInactiveTintColor: "#6b7280",
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="home-variant"
              size={size}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="orders"
        options={{
          title: "Orders",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="repeat" size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="categories"
        options={{
          title: "Categories",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="view-grid"
              size={size}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="cart"
        options={{
          title: "Cart",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="cart-outline" size={size} color={color} />
          ),
          tabBarBadge: cartItemCount > 0 ? cartItemCount : undefined,
        }}
      />
    </Tabs>
  );
}
