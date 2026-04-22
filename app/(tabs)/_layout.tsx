import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const PRIMARY = "#059669";
const BG = "#ffffff";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const baseHeight = 60;
  const basePaddingV = 8;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Detaching inactive tab screens keeps the JS thread (and memory)
        // free for the active tab — switching tabs in a grocery app feels
        // noticeably snappier when only one feed is mounted at a time.
        lazy: true,
        freezeOnBlur: true,

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
        name="order-again"
        options={{
          title: "Order Again",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="shopping-outline"
              size={size}
              color={color}
            />
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
    </Tabs>
  );
}
