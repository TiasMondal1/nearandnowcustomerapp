// codename: amber
// Tab bar (CONTRACTS §6.2, M8): cream scene background (no white flash on switch), PressableScale tab buttons
// with no Android ripple (it double-highlights with the scale), an icon pop on focus gain, and ONE haptic
// `select` on a real tab switch (DECISIONS D11 Q2 — no sound; a tab switch is navigation). The Home cart badge
// was dropped per D11 Q4 (no tab is the cart; the CartBar carries the count).
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import { Tabs } from "expo-router";
import React, { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PressableScale, spr, useMotionReduced, type IconName } from "../../components/ui";
import { C } from "../../constants/colors";
import { fontFamily, motion, TAB_BAR_BASE_HEIGHT } from "../../constants/ui";
import { getDevFlag, useDevFlag } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";

/** Tab bar vertical padding (owner's value). */
const TAB_BAR_PADDING_V = 8;

// ─── Tab button ──────────────────────────────────────────────────────────────

/**
 * The navigator's `tabBarButton`: PressableScale at `motion.scale.icon` with the default Android ripple removed.
 * The navigator's layout style (flex, column, padding) goes on the INNER Pressable so icon + label keep their
 * stock geometry; the outer Animated.View just flex-fills the item and carries the scale. Silent — the haptic is
 * fired once per real switch from `screenListeners.tabPress`, not per press.
 */
function TabBarButton({
  children,
  style,
  // PlatformPressable-only props — not forwarded to the RN Pressable.
  href: _href,
  hoverEffect: _hoverEffect,
  pressColor: _pressColor,
  pressOpacity: _pressOpacity,
  android_ripple: _ripple,
  ...rest
}: BottomTabBarButtonProps) {
  return (
    <PressableScale
      {...rest}
      scale={motion.scale.icon}
      haptic={false}
      android_ripple={null}
      style={styles.tabButtonOuter}
      innerStyle={style}
    >
      {children}
    </PressableScale>
  );
}

const renderTabBarButton = (props: BottomTabBarButtonProps) => <TabBarButton {...props} />;

// ─── Tab icon with the focus pop ─────────────────────────────────────────────

type TabIconProps = {
  focused: boolean;
  color: string;
  size: number;
  /** Filled glyph (focused). */
  active: IconName;
  /** Outline glyph (unfocused). */
  inactive: IconName;
};

/**
 * Outline → filled swap plus a pop on FOCUS GAIN: `withSequence(withSpring(1.15, pop), withSpring(1, press))`.
 * No pop on mount (the initial tab is already selected), under reduced motion, `Dev_Amber_inhibit_TabPop` or
 * `Dev_Amber_inhibit_Feature`.
 */
function TabIcon({ focused, color, size, active, inactive }: TabIconProps) {
  const scale = useSharedValue(1);
  const reduced = useMotionReduced();
  const popOff = useDevFlag("Dev_Amber_inhibit_TabPop");
  const amberOff = useDevFlag("Dev_Amber_inhibit_Feature");
  const wasFocusedRef = useRef(focused);

  useEffect(() => {
    const wasFocused = wasFocusedRef.current;
    wasFocusedRef.current = focused;
    if (!focused || wasFocused) return;
    if (reduced || popOff || amberOff) {
      scale.set(1);
      return;
    }
    scale.set(
      withSequence(withSpring(motion.scale.popLg, spr(motion.spring.pop)), withSpring(1, spr(motion.spring.press))),
    );
  }, [focused, reduced, popOff, amberOff, scale]);

  useEffect(() => () => cancelAnimation(scale), [scale]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <Animated.View style={animatedStyle}>
      <MaterialCommunityIcons name={focused ? active : inactive} size={size} color={color} />
    </Animated.View>
  );
}

// ─── Layout ──────────────────────────────────────────────────────────────────

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Detaching inactive tab screens keeps the JS thread (and memory)
        // free for the active tab — switching tabs in a grocery app feels
        // noticeably snappier when only one feed is mounted at a time.
        lazy: true,
        freezeOnBlur: true,

        // Cream behind every scene so a tab switch never flashes white (MAP §7.3).
        sceneStyle: { backgroundColor: C.bg },

        tabBarButton: renderTabBarButton,

        tabBarStyle: {
          backgroundColor: C.card,
          borderTopWidth: 1,
          borderTopColor: C.border,
          height: TAB_BAR_BASE_HEIGHT + insets.bottom,
          paddingBottom: Math.max(insets.bottom, TAB_BAR_PADDING_V),
          paddingTop: TAB_BAR_PADDING_V,
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
          fontFamily: fontFamily.semibold,
          letterSpacing: 0.2,
        },

        tabBarIconStyle: {
          marginTop: 0,
        },

        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.textSub,
      }}
      screenListeners={({ navigation }) => ({
        // One `select` haptic per REAL switch (re-pressing the current tab is silent); nothing under the master flag.
        tabPress: (e) => {
          if (getDevFlag("Dev_Amber_inhibit_Feature")) return;
          const state = navigation.getState();
          const currentKey = state.routes[state.index]?.key;
          if (e.target && e.target !== currentKey) feedback.select();
        },
      })}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} color={color} size={size} active="home-variant" inactive="home-variant-outline" />
          ),
        }}
      />

      <Tabs.Screen
        name="order-again"
        options={{
          title: "Order again",
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} color={color} size={size} active="shopping" inactive="shopping-outline" />
          ),
        }}
      />

      <Tabs.Screen
        name="categories"
        options={{
          title: "Categories",
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} color={color} size={size} active="view-grid" inactive="view-grid-outline" />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabButtonOuter: { flex: 1 },
});
