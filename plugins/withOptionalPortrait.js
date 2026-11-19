/**
 * Expo config plugin — keeps the app portrait-locked without the portrait
 * lock hiding it from devices on Google Play (2026-11-19; the shopkeeper and
 * rider apps carry the same declarations).
 *
 * `orientation: "portrait"` puts android:screenOrientation="portrait" on
 * MainActivity, and Android then treats the hardware feature
 * android.hardware.screen.portrait as REQUIRED. Play uses that to hide the
 * app from devices that don't report it (landscape-first tablets,
 * Chromebooks, Android XR) and warns "Required hardware feature declarations
 * are restricting your app's availability". Declaring the feature as not
 * required lifts that, and the app stays portrait in use. Touchscreen is the
 * other feature Android assumes by default; same treatment, so devices driven
 * by mouse and keyboard are not filtered out either.
 *
 * Only the manifest's <uses-feature> entries change; layout and orientation
 * do not.
 */
const { withAndroidManifest } = require("@expo/config-plugins");

const OPTIONAL_FEATURES = ["android.hardware.screen.portrait", "android.hardware.touchscreen"];

/** Apply to a parsed AndroidManifest. Idempotent. */
function markFeaturesOptional(manifest) {
  const usesFeature = manifest.manifest["uses-feature"] || [];
  for (const name of OPTIONAL_FEATURES) {
    const existing = usesFeature.find((f) => f?.$?.["android:name"] === name);
    if (existing) existing.$["android:required"] = "false";
    else usesFeature.push({ $: { "android:name": name, "android:required": "false" } });
  }
  manifest.manifest["uses-feature"] = usesFeature;
  return manifest;
}

module.exports = function withOptionalPortrait(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults = markFeaturesOptional(mod.modResults);
    return mod;
  });
};
module.exports.markFeaturesOptional = markFeaturesOptional;
