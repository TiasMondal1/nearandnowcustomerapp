import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { C } from "../../constants/colors";
import { TAB_BAR_BASE_HEIGHT } from "../../constants/ui";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const baseHeight = TAB_BAR_BASE_HEIGHT;
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
          backgroundColor: C.card,
          borderTopWidth: 1,
          borderTopColor: C.border,
          height: baseHeight + insets.bottom,
          paddingBottom: Math.max(insets.bottom, basePaddingV),
          paddingTop: basePaddingV,
          position: "absolute",
          bottom: 0,
          shadowColor: C.shadow,
          shadowOffset: { width: 0, height: -3 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
          elevation: 4,
        },

        tabBarItemStyle: {
          paddingVertical: 2,
        },

        tabBarLabelStyle: {
          fontSize: 11,
          marginTop: 4,
          marginBottom: 0,
          fontFamily: "PlusJakartaSans_600SemiBold",
          letterSpacing: 0.2,
        },

        tabBarIconStyle: {
          marginTop: 0,
        },

        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.textSub,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons
              name={focused ? "home-variant" : "home-variant-outline"}
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
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons
              name={focused ? "shopping" : "shopping-outline"}
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
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons
              name={focused ? "view-grid" : "view-grid-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
