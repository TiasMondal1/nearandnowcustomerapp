import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

const PRIMARY = "#b039c2ff";
const BG = "#05030A";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,

        tabBarStyle: {
          backgroundColor: BG,
          borderTopWidth: 0,
          height: 5, // ✅ real, supported height
          paddingBottom: 90, // ✅ small, controlled
          paddingTop: 0,
          position: "absolute", // ✅ avoid overlap
        },

        tabBarItemStyle: {
          paddingVertical: 0, // ✅ no extra vertical space
        },

        tabBarLabelStyle: {
          fontSize: 10,
          marginTop: 0,
          marginBottom: 2,
        },

        tabBarIconStyle: {
          marginTop: 2,
        },

        tabBarActiveTintColor: PRIMARY,
        tabBarInactiveTintColor: "#9C94D7",
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
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="cog" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
