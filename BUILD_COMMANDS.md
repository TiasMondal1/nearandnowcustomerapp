# Near & Now Customer — Build Commands

This app is set up so you can build release APKs **locally** with Gradle (no EAS
Cloud queue, no upload). The same `eas.json` config is kept for cloud AAB builds
when you publish to the Play Store.

## Prerequisites (one time)

- **JDK 17** on PATH (`java -version` shows `17.x`). Temurin 17 is what this
  repo targets.
- **Android SDK** installed. The path lives in `android/local.properties`:

  ```properties
  sdk.dir=C:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
  ```

- `.env` at the project root with at minimum:

  ```dotenv
  EXPO_PUBLIC_API_BASE_URL=https://your-backend.example.com
  EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
  EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=AIza...
  ```

## First-time native prebuild

Only run this once, or after you change `app.config.js`, add a native module,
or bump an `expo-*` SDK. It regenerates `android/` from scratch **and re-applies
our custom patches** (ABI splits, release signing, R8 config, etc.) via
`scripts/patch-android.js`:

```bash
npm run prebuild:android
```

If you ever need to re-apply only the patches without a full prebuild:

```bash
npm run patch:android
```

## App icon

The icon lives at `assets/near_and_now_logo.png` (black background, centered
logo). To regenerate every variant (icon, adaptive foreground, monochrome,
splash, notification, favicon) from that one source image:

```bash
npm run icons:generate
npm run prebuild:android      # regenerate native mipmaps
npm run build:apk             # rebuild
```

The generator uses sharp and produces:

| Output | Where it's used |
|---|---|
| `assets/images/icon.png` | Main app icon (iOS + legacy Android) — logo at 90% of canvas on black |
| `assets/images/adaptive-icon-foreground.png` | Android adaptive icon — logo at **62%** so the tagline doesn't get cropped by the OS circle/squircle mask |
| `assets/images/adaptive-icon-monochrome.png` | Android 13+ themed-icon — white silhouette |
| `assets/images/splash-icon.png` | Splash screen (black background via `expo-splash-screen`) |
| `assets/images/notification-icon.png` | 96×96 white silhouette for push notifications |
| `assets/images/favicon.png` | Web favicon |

## Local APK builds

### Two APKs, one per architecture (recommended)

Produces two smaller APKs instead of a single fat one:

```bash
npm run build:apk
```

Outputs:

| File | Who it's for | Typical size |
|---|---|---|
| `android/app/build/outputs/apk/release/app-arm64-v8a-release.apk` | **Premium** — modern 64-bit phones (Android 7+, almost every phone made since 2017) | ~25–35 MB |
| `android/app/build/outputs/apk/release/app-armeabi-v7a-release.apk` | **Medium** — older 32-bit phones (budget devices, 2014–2018) | ~22–30 MB |

### Build just one variant

```bash
npm run build:apk:premium     # → app-arm64-v8a-release.apk
npm run build:apk:medium      # → app-armeabi-v7a-release.apk
```

### Universal APK (single file that runs on every CPU, ~40–55 MB)

If you only want one file to hand around and don't care about size:

```bash
npm run build:apk:universal
```

Output: `android/app/build/outputs/apk/release/app-universal-release.apk`

### AAB for Google Play

```bash
npm run build:aab
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

> `bundleRelease` requires a **real upload keystore** (see next section).
> `assembleRelease` (APK) falls back to the debug key for side-loaded builds.

## Release signing key

For **side-loaded APKs** shared with testers, you can skip this — the build
falls back to the debug keystore automatically.

For **Play Store** (AAB), or if you want consistent signatures across devices:

```bash
npm run keystore:generate
```

This creates:

- `android/app/upload-keystore.jks` (the key, **gitignored**)
- `android/keystore.properties` (passwords, **gitignored**)

**Back both files up somewhere safe immediately.** If you lose them you can
never ship an update to the Play Store listing.

If you already have a keystore, copy `android/keystore.properties.example` to
`android/keystore.properties` and fill in the real values instead.

## EAS Cloud build (optional — same config as shopkeeper)

Produces an AAB on Expo's build servers, no local Android SDK needed:

```bash
npm run build:android
```

Uses the `production` profile in `eas.json`. Requires `eas login` once.

## Why the APKs are small

- **ABI splits** — each APK only ships one CPU architecture (`arm64-v8a` or
  `armeabi-v7a`) instead of all four. Saves ~10 MB per APK.
- **R8 minification + resource shrinking** enabled in release
  (`android.enableMinifyInReleaseBuilds=true` in `gradle.properties`).
- **Hermes** engine (pre-compiled bytecode, smaller than JSC).
- **PNG crunching** enabled (`android.enablePngCrunchInReleaseBuilds=true`).
- **JS bundle compression** enabled (`android.enableBundleCompression=true`).
- **Animated WebP disabled** (saves ~3.4 MB).
- `x86` / `x86_64` ABIs excluded (they only run on Android emulators).

If R8 breaks a library at runtime (unexpected crashes in release only), add a
`-keep` rule for that package to `android/app/proguard-rules.pro` and rebuild.

## Raw Gradle equivalents

If you want to bypass the Node helper (won't load `.env` automatically):

```bash
cd android

# Two split APKs
.\gradlew.bat assembleRelease                              # Windows
./gradlew assembleRelease                                  # macOS / Linux

# Only one architecture
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a
.\gradlew.bat assembleRelease -PreactNativeArchitectures=armeabi-v7a

# Universal APK alongside the splits
.\gradlew.bat assembleRelease -PbuildUniversalApk=true

# AAB for Play Store
.\gradlew.bat bundleRelease
```
