/**
 * Dynamic Expo config.
 *
 * Reads sensitive keys from environment variables (.env) so they don't sit in
 * a committed JSON file. Required for release builds:
 *   EXPO_PUBLIC_GOOGLE_MAPS_API_KEY  (baked into AndroidManifest for react-native-maps)
 *
 * Other EXPO_PUBLIC_* values (Supabase URL / anon key, API base URL) are read
 * at runtime from process.env because they are prefixed with EXPO_PUBLIC_.
 *
 * Expo CLI auto-loads .env for expo-cli commands, expo prebuild, and EAS
 * builds, so process.env.EXPO_PUBLIC_* is populated here.
 */
const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";

module.exports = {
  expo: {
    name: "Near & Now",
    slug: "near-and-now-customer",
    version: "1.0.0",
    orientation: "portrait",
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
        backgroundColor: "#000000",
        foregroundImage: "./assets/images/adaptive-icon-foreground.png",
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
          image: "./assets/images/splash-icon.png",
          imageWidth: 240,
          resizeMode: "contain",
          backgroundColor: "#000000",
          dark: {
            image: "./assets/images/splash-icon.png",
            backgroundColor: "#000000",
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
      eas: {
        projectId: "YOUR_EAS_PROJECT_ID",
      },
    },
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  },
};
