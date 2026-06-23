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
const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const apiBaseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  "https://near-and-now-backend.vercel.app";
const easProjectId =
  process.env.EAS_PROJECT_ID || process.env.EXPO_PUBLIC_EAS_PROJECT_ID || "";

module.exports = {
  expo: {
    name: "Near & Now",
    slug: "near-and-now-customer",
    version: "1.0.0",
    orientation: "default",
    icon: "./assets/near_now_image.png",
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
        foregroundImage: "./assets/near_now_image.png",
        monochromeImage: "./assets/images/adaptive-icon-monochrome.png",
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      package: "com.nearandnow.customer",
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
          defaultChannel: "orders",
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
