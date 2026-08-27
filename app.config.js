/**
 * Dynamic Expo config.
 *
 * Two-layer env strategy:
 * 1. process.env.EXPO_PUBLIC_* — Metro inlines these at bundle time (works for
 *    local builds and EAS builds when vars are set in the EAS dashboard).
 * 2. Constants.expoConfig.extra — app.config.js runs in the Expo CLI/EAS process
 *    which always has access to env vars. Values written here are baked into the
 *    app manifest and available at runtime via Constants.expoConfig.extra even if
 *    Metro inlining doesn't fire (e.g. dynamic access, hermes quirks).
 *
 * Set these in the EAS dashboard (expo.dev → project → Environment Variables)
 * for production builds: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY,
 * EXPO_PUBLIC_API_BASE_URL, EXPO_PUBLIC_GOOGLE_MAPS_API_KEY.
 */
const fs = require("fs");
const path = require("path");

// This app's android/ directory is gitignored (managed workflow — EAS Build
// runs `expo prebuild` fresh from this config every time), so referencing a
// googleServicesFile path that doesn't exist yet would make prebuild throw
// ("Cannot copy google-services.json ... Ensure the source and destination
// paths exist", @expo/config-plugins android/GoogleServices.js) and fail
// every build, not just leave push notifications broken. Guard it so the
// field only activates once the real file (from Firebase console — see
// FCM_PUSH_NOTIFICATIONS_SETUP.md) is actually placed here.
// EAS Build uploads only git-tracked files, and google-services.json is
// (deliberately) gitignored — so a cloud build never actually has the local
// copy, even when one sits in this folder. An EAS "file" environment
// variable (GOOGLE_SERVICES_JSON) is EAS's documented answer: it's synced
// into the build regardless of gitignore, and EAS points this env var at
// wherever it placed the file on the build machine. Prefer that path; fall
// back to the local file for `expo prebuild`/local builds where no such env
// var exists.
const googleServicesFilePath =
  process.env.GOOGLE_SERVICES_JSON || path.join(__dirname, "google-services.json");
const hasGoogleServicesFile = fs.existsSync(googleServicesFilePath);

const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const apiBaseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  "https://near-and-now-backend.vercel.app";
// Fallback hardcoded, not just env-sourced — this app's EAS project (auto-
// created 2026-08-25 via `eas credentials`, since none existed until then)
// previously had no projectId anywhere and no EXPO_PUBLIC_EAS_PROJECT_ID set
// in .env either, so getExpoPushTokenAsync() had nothing to resolve and push
// registration silently failed client-side for every install. Hardcoding the
// real id here (same pattern as near-now-store_owner/app.config.js) means it
// no longer depends on any particular environment having the env var set —
// EAS can't auto-write this into a dynamic (.js) config, so it has to be here.
const easProjectId =
  process.env.EAS_PROJECT_ID ||
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
  "e82db4c9-66dc-4d49-b134-9bdd64a3c8f2";

module.exports = {
  expo: {
    name: "Near & Now",
    slug: "near-and-now-customer",
    version: "1.0.0",
    orientation: "default",
    icon: "./assets/images/icon.png",
    scheme: "nearandnow",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      supportsTablet: false,
      bundleIdentifier: "com.nearandnow.customer",
      buildNumber: "1",
      config: {
        googleMapsApiKey,
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#ffffff",
        foregroundImage: "./assets/images/adaptive-icon-foreground.png",
        monochromeImage: "./assets/images/adaptive-icon-monochrome.png",
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      package: "com.nearandnow.customer",
      // Firebase Android config for this app (package com.nearandnow.customer)
      // in the Firebase console — required for getExpoPushTokenAsync() to work
      // on Android at all. Without it, FCM never initializes natively and push
      // registration silently fails (falls into the token-failed catch in
      // hooks/usePushNotifications.dev.ts) even though everything else looks configured.
      // Only set once the file actually exists — see guard comment above.
      // Use the resolved path directly (not a hardcoded relative string):
      // when it comes from EAS's GOOGLE_SERVICES_JSON file env var it's an
      // absolute path elsewhere on the build machine, not relative to this file.
      ...(hasGoogleServicesFile ? { googleServicesFile: googleServicesFilePath } : {}),
      versionCode: 1,
      permissions: [
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.RECEIVE_BOOT_COMPLETED",
        "android.permission.VIBRATE",
        "android.permission.POST_NOTIFICATIONS",
      ],
      config: {
        googleMaps: {
          apiKey: googleMapsApiKey,
        },
      },
    },
    web: {
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      [
        "expo-splash-screen",
        {
          image: "./assets/near_now_image.png",
          imageWidth: 240,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
          dark: {
            image: "./assets/near_now_image.png",
            backgroundColor: "#ffffff",
          },
        },
      ],
      "expo-font",
      [
        "expo-notifications",
        {
          icon: "./assets/images/notification-icon.png",
          color: "#0EA5E9",
          defaultChannel: "orders_v2",
          sounds: ["./assets/sounds/order_chime.wav"],
        },
      ],
      [
        "@sentry/react-native",
        {
          url: "https://sentry.io/",
          project: "react-native",
          organization: "near-now",
        },
      ],
      "expo-web-browser",
    ],
    extra: {
      supabaseUrl,
      supabaseAnonKey,
      apiBaseUrl,
      googleMapsApiKey,
      eas: {
        // EAS injects EAS_PROJECT_ID during cloud builds; for local dev set EXPO_PUBLIC_EAS_PROJECT_ID in .env
        ...(easProjectId ? { projectId: easProjectId } : {}),
      },
    },
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  },
};
