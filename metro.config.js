const path = require("path");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// react-native-maps has no web implementation and crashes the entire web
// bundle outright (not just the screens that use it — expo-router eagerly
// resolves every route for web). Alias it to a lightweight placeholder on
// web only; native builds are completely unaffected. See web-mocks/
// react-native-maps.js. Found + fixed 2026-08-13 via live click-testing.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && moduleName === "react-native-maps") {
    return {
      filePath: path.resolve(__dirname, "web-mocks/react-native-maps.js"),
      type: "sourceFile",
    };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
