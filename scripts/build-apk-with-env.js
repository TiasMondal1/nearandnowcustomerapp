#!/usr/bin/env node
/**
 * Build release APK / AAB with .env loaded so EXPO_PUBLIC_* values are baked
 * into the JS bundle and the native manifest (Google Maps key).
 *
 * Usage (from project root):
 *   node scripts/build-apk-with-env.js                → split APKs (arm64 + armv7)
 *   node scripts/build-apk-with-env.js universal      → single universal APK (all ABIs)
 *   node scripts/build-apk-with-env.js premium        → arm64-v8a only (modern phones)
 *   node scripts/build-apk-with-env.js medium         → armeabi-v7a only (older phones)
 *   node scripts/build-apk-with-env.js aab            → AAB for Play Store
 */
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const envPath = path.join(rootDir, ".env");

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  content.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) return;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key.startsWith("EXPO_PUBLIC_") || key === "NODE_ENV") {
      process.env[key] = val;
    }
  });

  const apiUrl = process.env.EXPO_PUBLIC_API_BASE_URL || "";
  const supaUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
  const supaKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
  const mapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";
  console.log("Loaded .env:");
  console.log("  EXPO_PUBLIC_API_BASE_URL      =", apiUrl || "(not set)");
  console.log("  EXPO_PUBLIC_SUPABASE_URL      =", supaUrl || "(not set)");
  console.log("  EXPO_PUBLIC_SUPABASE_ANON_KEY =", supaKey ? supaKey.slice(0, 20) + "…" : "(not set)");
  console.log("  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=", mapsKey ? mapsKey.slice(0, 8) + "… (native manifest + JS)" : "(not set — MapView may crash in release)");

  if (!supaUrl || !supaKey) {
    console.error("\nERROR: EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY missing from .env.");
    console.error("The built app will have no Supabase connection. Add them to .env and rebuild.\n");
  }
  if (!apiUrl || apiUrl.includes("localhost") || apiUrl.includes("127.0.0.1")) {
    console.warn("\nWARNING: EXPO_PUBLIC_API_BASE_URL is not set or points to localhost.");
    console.warn("Set it to your production URL (e.g. https://api.yourdomain.com) before distributing the APK.\n");
  }
} else {
  console.warn("No .env file found. EXPO_PUBLIC_* values will be empty in the built app.");
}

process.env.NODE_ENV = process.env.NODE_ENV || "production";

// Sentry source-map upload is a post-build step that requires SENTRY_AUTH_TOKEN.
// For local / side-loaded APK builds we don't need it — disable auto-upload so
// the Gradle task doesn't fail. Set SENTRY_AUTH_TOKEN in the environment to
// re-enable uploads (e.g. on CI or before shipping a Play Store build).
if (!process.env.SENTRY_AUTH_TOKEN) {
  process.env.SENTRY_DISABLE_AUTO_UPLOAD = "true";
  process.env.SENTRY_ALLOW_FAILURE = "true";
  console.log("SENTRY_AUTH_TOKEN not set — Sentry source-map upload disabled for this build.");
}

const androidDir = path.join(rootDir, "android");
const isWin = process.platform === "win32";
const gradleWrapper = isWin ? "gradlew.bat" : "gradlew";
const gradle = path.join(androidDir, gradleWrapper);

const env = {
  ...process.env,
  JAVA_TOOL_OPTIONS:
    "--enable-native-access=ALL-UNNAMED --add-opens=java.base/java.lang=ALL-UNNAMED --add-opens=java.base/java.io=ALL-UNNAMED",
};

const run = (gradleArgs) => {
  if (isWin) {
    return spawnSync("cmd.exe", ["/c", gradle, ...gradleArgs], {
      cwd: androidDir,
      env,
      stdio: "inherit",
    });
  }
  return spawnSync(gradle, gradleArgs, {
    cwd: androidDir,
    env,
    stdio: "inherit",
  });
};

run(["--stop"]);

const bundleDirs = [
  path.join(androidDir, "app/build/intermediates/assets"),
  path.join(androidDir, "app/build/intermediates/merged_assets"),
  path.join(androidDir, "app/build/generated/assets"),
];
bundleDirs.forEach((dir) => {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log("Cleared bundle cache:", dir);
  }
});

const target = (process.argv[2] || "split").toLowerCase();

// target → { task, extraProps, output description }
const targets = {
  split: {
    task: "assembleRelease",
    props: [],
    out: "android/app/build/outputs/apk/release/ (app-arm64-v8a-release.apk + app-armeabi-v7a-release.apk)",
  },
  universal: {
    task: "assembleRelease",
    props: ["-PbuildUniversalApk=true"],
    out: "android/app/build/outputs/apk/release/app-universal-release.apk",
  },
  premium: {
    task: "assembleRelease",
    props: ["-PreactNativeArchitectures=arm64-v8a"],
    out: "android/app/build/outputs/apk/release/app-arm64-v8a-release.apk  (premium / modern 64-bit phones)",
  },
  medium: {
    task: "assembleRelease",
    props: ["-PreactNativeArchitectures=armeabi-v7a"],
    out: "android/app/build/outputs/apk/release/app-armeabi-v7a-release.apk  (medium / older 32-bit phones)",
  },
  aab: {
    task: "bundleRelease",
    props: [],
    out: "android/app/build/outputs/bundle/release/app-release.aab",
  },
};

const chosen = targets[target];
if (!chosen) {
  console.error(`Unknown target "${target}". Use one of: ${Object.keys(targets).join(", ")}`);
  process.exit(1);
}

console.log(`\nGradle task: ${chosen.task}  (${chosen.props.join(" ") || "default"})`);
console.log(`Expected output: ${chosen.out}\n`);

const result = run([chosen.task, ...chosen.props]);

if (result.error) {
  console.error("Gradle failed to start:", result.error.message || result.error);
}

if ((result.status ?? 1) === 0) {
  console.log(`\nDone. Output in: ${chosen.out}`);
}

process.exit(result.status ?? 1);
