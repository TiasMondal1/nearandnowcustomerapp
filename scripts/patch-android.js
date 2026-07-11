#!/usr/bin/env node
/**
 * Re-apply our Android customizations after `expo prebuild --clean`.
 *
 * `expo prebuild --clean` nukes the entire android/ folder and regenerates it
 * from the Expo template. Any manual edits we make to build.gradle,
 * gradle.properties, proguard-rules.pro, or local.properties disappear.
 *
 * This script patches those files idempotently — run it after every prebuild
 * (the `prebuild:android` npm script calls it automatically).
 *
 * Patches applied:
 *   android/local.properties                    write sdk.dir if missing
 *   android/gradle.properties                   enable minify + shrink + bundle compression, narrow ABIs
 *   android/app/build.gradle                    add ABI splits + release signing config
 *   android/app/proguard-rules.pro              add keep rules for razorpay/sentry/maps/etc
 */
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const androidDir = path.join(rootDir, "android");
const appDir = path.join(androidDir, "app");

if (!fs.existsSync(androidDir)) {
  console.error("No android/ folder — run `expo prebuild --platform android` first.");
  process.exit(1);
}

const changes = [];
function note(msg) {
  changes.push(msg);
  console.log("  " + msg);
}

// ─── 1. local.properties ────────────────────────────────────────────────────
const localPropsPath = path.join(androidDir, "local.properties");
if (!fs.existsSync(localPropsPath)) {
  const sdkDir = process.env.ANDROID_HOME
    || process.env.ANDROID_SDK_ROOT
    || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk") : null);
  if (sdkDir) {
    const escaped = sdkDir.replace(/\\/g, "\\\\");
    fs.writeFileSync(localPropsPath, `sdk.dir=${escaped}\n`, "utf8");
    note(`local.properties written with sdk.dir=${sdkDir}`);
  } else {
    console.warn("  local.properties missing and no ANDROID_HOME / LOCALAPPDATA\\Android\\Sdk found — set sdk.dir manually.");
  }
}

// ─── 2. gradle.properties ───────────────────────────────────────────────────
const gpPath = path.join(androidDir, "gradle.properties");
let gp = fs.readFileSync(gpPath, "utf8");

function ensureProp(key, value, commentBefore) {
  const re = new RegExp(`^${key}\\s*=.*$`, "m");
  const line = `${key}=${value}`;
  if (re.test(gp)) {
    const before = gp;
    gp = gp.replace(re, line);
    if (before !== gp) note(`gradle.properties: updated ${key}=${value}`);
  } else {
    gp = gp.trimEnd() + "\n\n" + (commentBefore ? `# ${commentBefore}\n` : "") + line + "\n";
    note(`gradle.properties: added ${key}=${value}`);
  }
}

ensureProp("android.enableShrinkResourcesInReleaseBuilds", "true", "Shrink unused resources in release (smaller APK)");
ensureProp("android.enableMinifyInReleaseBuilds", "true", "Enable R8 full-mode minification in release");
ensureProp("android.enableBundleCompression", "true", "Compress the JS bundle inside the APK");
ensureProp("reactNativeArchitectures", "armeabi-v7a,arm64-v8a,x86_64", "Build every ABI we split on (must match splits.abi.include in app/build.gradle)");
ensureProp("buildUniversalApk", "true", "Emit a universal (all-ABI) APK alongside the per-ABI split APKs");

fs.writeFileSync(gpPath, gp, "utf8");

// ─── 3. app/build.gradle ────────────────────────────────────────────────────
const bgPath = path.join(appDir, "build.gradle");
let bg = fs.readFileSync(bgPath, "utf8");

const MARKER_TOP = "// @NN_PATCH keystore+splits (managed by scripts/patch-android.js)";
const keystoreBlock = `
${MARKER_TOP}
def keystoreProperties = new Properties()
def keystorePropsFile = rootProject.file("keystore.properties")
if (keystorePropsFile.exists()) {
    def ksBytes = keystorePropsFile.bytes
    def off = 0
    if (ksBytes.length >= 3 && (ksBytes[0] & 0xFF) == 0xEF && (ksBytes[1] & 0xFF) == 0xBB && (ksBytes[2] & 0xFF) == 0xBF) {
        off = 3
    }
    keystoreProperties.load(new ByteArrayInputStream(ksBytes, off, ksBytes.length - off))
}
def releaseStoreFile = System.getenv("ANDROID_UPLOAD_STORE_FILE") ?: keystoreProperties.getProperty("storeFile")
def releaseStorePassword = System.getenv("ANDROID_UPLOAD_STORE_PASSWORD") ?: keystoreProperties.getProperty("storePassword")
def releaseKeyAlias = System.getenv("ANDROID_UPLOAD_KEY_ALIAS") ?: keystoreProperties.getProperty("keyAlias")
def releaseKeyPassword = System.getenv("ANDROID_UPLOAD_KEY_PASSWORD") ?: keystoreProperties.getProperty("keyPassword")
def hasReleaseSigning = releaseStoreFile?.trim() && releaseStorePassword?.trim() && releaseKeyAlias?.trim() && releaseKeyPassword?.trim()

// Controlled from gradle.properties or the CLI: -PbuildUniversalApk=false disables the fat APK.
def buildUniversalApk = (findProperty('buildUniversalApk') ?: 'true').toBoolean()

// Unique multiplier per ABI so every split APK gets a distinct versionCode (see applicationVariants below).
def abiVersionCodes = ["armeabi-v7a": 1, "x86": 2, "arm64-v8a": 3, "x86_64": 4]
`;

// 3a. Insert the keystore block once, immediately before the `android {` block.
if (!bg.includes(MARKER_TOP)) {
  bg = bg.replace(/\nandroid\s*\{/, keystoreBlock + "\nandroid {");
  note("build.gradle: inserted keystore + buildUniversalApk helpers");
}

// 3b. Inject ABI splits config inside the android block (after `namespace ...`).
if (!bg.includes("// @NN_PATCH splits")) {
  const splitsBlock = `
    // @NN_PATCH splits — one APK per CPU arch (arm64-v8a, armeabi-v7a, x86_64) + a universal fat APK.
    splits {
        abi {
            reset()
            enable true
            universalApk buildUniversalApk
            include "armeabi-v7a", "arm64-v8a", "x86_64"
        }
    }
`;
  // Insert after the first `namespace '...'` line inside the android block.
  bg = bg.replace(/(\n\s*namespace\s+'[^']+'\s*\n)/, `$1${splitsBlock}`);
  note("build.gradle: injected ABI splits config");
}

// 3c. Add a real `release` signing config and swap the release buildType to use it.
if (!bg.includes("// @NN_PATCH release-signing")) {
  // Add signingConfigs.release after the debug block.
  bg = bg.replace(
    /(signingConfigs\s*\{\s*debug\s*\{[\s\S]*?keyPassword 'android'\s*\})/,
    `$1
        release {
            // @NN_PATCH release-signing
            if (hasReleaseSigning) {
                storeFile file(releaseStoreFile)
                storePassword releaseStorePassword
                keyAlias releaseKeyAlias
                keyPassword releaseKeyPassword
            }
        }`,
  );
  // Swap the release buildType's signingConfig.
  bg = bg.replace(
    /release\s*\{\s*\/\/ Caution![\s\S]*?signingConfig signingConfigs\.debug/,
    `release {
            // @NN_PATCH release-signing — use upload key if configured, else fall back to debug key so assembleRelease still works for side-loading.
            signingConfig hasReleaseSigning ? signingConfigs.release : signingConfigs.debug`,
  );
  note("build.gradle: added release signing config");
}

// 3d. Guard bundleRelease (AAB) against debug-signing — Play Store would reject it.
if (!bg.includes("// @NN_PATCH aab-guard")) {
  bg += `

// @NN_PATCH aab-guard — refuse to produce an unsigned AAB. APKs fall back to the debug key automatically.
tasks.matching { it.name == "bundleRelease" }.configureEach {
    doFirst {
        if (!hasReleaseSigning) {
            throw new GradleException(
                "Release signing is not configured. Google Play rejects debug-signed AAB. " +
                "Copy android/keystore.properties.example to android/keystore.properties and fill in real values, " +
                "or run \`npm run keystore:generate\`."
            )
        }
    }
}
`;
  note("build.gradle: added bundleRelease signing guard");
}

// 3e. Give each per-ABI split APK a distinct versionCode so they can coexist on the Play Store.
if (!bg.includes("// @NN_PATCH abi-version-codes")) {
  const abiVersionCodeBlock = `// @NN_PATCH abi-version-codes — give each per-ABI split APK a distinct versionCode so they can
// coexist on the Play Store. Formula: base versionCode * 1000 + ABI offset. The universal APK
// (ABI filter == null) keeps the plain base versionCode.
android.applicationVariants.all { variant ->
    variant.outputs.each { output ->
        def abiName = output.getFilter(com.android.build.OutputFile.ABI)
        def abiOffset = abiVersionCodes.get(abiName)
        if (abiOffset != null) {
            output.versionCodeOverride = variant.versionCode * 1000 + abiOffset
        }
    }
}

`;
  // Insert immediately before the top-level `dependencies {` block.
  bg = bg.replace(/\ndependencies\s*\{/, `\n${abiVersionCodeBlock}dependencies {`);
  note("build.gradle: added per-ABI versionCode overrides");
}

fs.writeFileSync(bgPath, bg, "utf8");

// ─── 4. app/proguard-rules.pro ──────────────────────────────────────────────
const prPath = path.join(appDir, "proguard-rules.pro");
let pr = fs.readFileSync(prPath, "utf8");

const PR_MARKER = "# @NN_PATCH keep-rules";
if (!pr.includes(PR_MARKER)) {
  pr += `

${PR_MARKER} (managed by scripts/patch-android.js)

# --- React Native core / new arch ---
-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.hermes.** { *; }

# --- react-native-reanimated / worklets ---
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.worklets.** { *; }

# --- react-native-gesture-handler ---
-keep class com.swmansion.gesturehandler.** { *; }

# --- react-native-screens ---
-keep class com.swmansion.rnscreens.** { *; }

# --- react-native-maps ---
-keep class com.airbnb.android.react.maps.** { *; }
-keep class com.google.android.gms.maps.** { *; }
-keep class com.google.maps.** { *; }

# --- Razorpay checkout (heavy reflection via its webview bridge) ---
-keepattributes JavascriptInterface
-keepattributes *Annotation*
-keep class com.razorpay.** { *; }
-dontwarn com.razorpay.**
-keep class proguard.annotation.Keep
-keep class proguard.annotation.KeepClassMembers
-keep @proguard.annotation.Keep class * { *; }
-keepclassmembers class * {
    @proguard.annotation.Keep *;
}

# --- Sentry ---
-keep class io.sentry.** { *; }
-dontwarn io.sentry.**

# --- OkHttp / Okio (used transitively by several libs) ---
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**

-keepattributes Signature, InnerClasses, EnclosingMethod, Exceptions, *Annotation*
`;
  fs.writeFileSync(prPath, pr, "utf8");
  note("proguard-rules.pro: appended keep rules");
}

// ─── 5. .gitignore ──────────────────────────────────────────────────────────
const giPath = path.join(androidDir, ".gitignore");
if (fs.existsSync(giPath)) {
  let gi = fs.readFileSync(giPath, "utf8");
  const GI_MARKER = "# @NN_PATCH keystore-secrets";
  if (!gi.includes(GI_MARKER)) {
    gi += `
${GI_MARKER}
keystore.properties
app/upload-keystore.jks
app/*.keystore
!app/debug.keystore
`;
    fs.writeFileSync(giPath, gi, "utf8");
    note(".gitignore: added keystore secret ignores");
  }
}

// ─── 6. keystore.properties.example ─────────────────────────────────────────
const ksExPath = path.join(androidDir, "keystore.properties.example");
if (!fs.existsSync(ksExPath)) {
  fs.writeFileSync(
    ksExPath,
    `# Copy this to android/keystore.properties and fill in real values.
# keystore.properties is gitignored — never commit real keys.
#
# storeFile path is relative to android/app/. Use \`npm run keystore:generate\`
# to create a fresh upload keystore + auto-fill these properties.

storeFile=upload-keystore.jks
storePassword=CHANGE_ME
keyAlias=upload
keyPassword=CHANGE_ME
`,
    "utf8",
  );
  note("keystore.properties.example: created");
}

// ─── 7. AndroidManifest.xml — tablet support ────────────────────────────────
const manifestPath = path.join(appDir, "src/main/AndroidManifest.xml");
if (fs.existsSync(manifestPath)) {
  let mf = fs.readFileSync(manifestPath, "utf8");
  let mfChanged = false;

  // Add <supports-screens> if missing.
  if (!mf.includes("<supports-screens")) {
    mf = mf.replace(
      /(\s*<application\s)/,
      `\n  <supports-screens\n    android:smallScreens="true"\n    android:normalScreens="true"\n    android:largeScreens="true"\n    android:xlargeScreens="true"\n    android:resizeable="true"/>$1`,
    );
    note("AndroidManifest.xml: added <supports-screens> for tablet support");
    mfChanged = true;
  }

  // Change screenOrientation from portrait to unspecified.
  if (mf.includes('android:screenOrientation="portrait"')) {
    mf = mf.replace('android:screenOrientation="portrait"', 'android:screenOrientation="unspecified"');
    note("AndroidManifest.xml: changed screenOrientation portrait → unspecified");
    mfChanged = true;
  }

  // Add smallestScreenSize to configChanges if missing.
  if (!mf.includes("smallestScreenSize") && mf.includes("android:configChanges=")) {
    mf = mf.replace(
      /android:configChanges="([^"]+)"/,
      (_, existing) => `android:configChanges="${existing}|smallestScreenSize"`,
    );
    note("AndroidManifest.xml: added smallestScreenSize to configChanges");
    mfChanged = true;
  }

  // Add android:resizeableActivity="true" to the MainActivity if missing.
  if (!mf.includes("android:resizeableActivity") && mf.includes("android:screenOrientation")) {
    mf = mf.replace(
      /android:screenOrientation="[^"]+"/,
      (match) => `${match} android:resizeableActivity="true"`,
    );
    note("AndroidManifest.xml: added resizeableActivity=true");
    mfChanged = true;
  }

  if (mfChanged) {
    fs.writeFileSync(manifestPath, mf, "utf8");
  }
}

if (changes.length === 0) {
  console.log("Android project already patched — nothing to do.");
} else {
  console.log(`\nPatched android/ with ${changes.length} change(s).`);
}
