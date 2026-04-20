#!/usr/bin/env node
/**
 * Generate all app icon variants from a single source logo.
 *
 * Input:
 *   assets/near_and_now_logo.png   (any square-ish logo, any size, any background)
 *
 * Outputs (1024x1024 unless noted):
 *   assets/images/icon.png                         main app icon (iOS + legacy Android)
 *   assets/images/adaptive-icon-foreground.png     Android adaptive icon foreground, logo scaled into the 66% safe zone
 *   assets/images/adaptive-icon-monochrome.png     Android 13+ themed-icon variant (white silhouette)
 *   assets/images/splash-icon.png                  splash screen logo
 *   assets/images/notification-icon.png            96x96 white silhouette used for push notifications
 *   assets/images/favicon.png                      64x64 web favicon
 *
 * Why all the padding math:
 *   - iOS masks a rounded square → ~5% visual margin keeps the logo from touching the edge.
 *   - Android adaptive icons draw the foreground inside a 108dp canvas but only the inner
 *     66dp is guaranteed visible through the OS mask (circle, squircle, …). So the logo
 *     must sit inside the center ~62% or the bottom "Digital Dukan, Local Dil Se" tagline
 *     gets cropped.
 */
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

const rootDir = path.resolve(__dirname, "..");
const sourceLogo = path.join(rootDir, "assets", "near_and_now_logo.png");
const imagesDir = path.join(rootDir, "assets", "images");

if (!fs.existsSync(sourceLogo)) {
  console.error("Source logo not found:", sourceLogo);
  process.exit(1);
}

if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

const BRAND_BLACK = { r: 0, g: 0, b: 0, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * Trim outer uniform-color padding from the source (e.g. big black borders the
 * logo was saved with) so we know the logo's real bounding box.
 */
async function loadTrimmedLogo() {
  const img = sharp(sourceLogo).trim({ threshold: 10 });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height, channels: info.channels };
}

/**
 * Place the trimmed logo on a fresh canvas of `canvasSize`, sized so that its
 * longest edge is `contentFraction * canvasSize`. Rest of the canvas is filled
 * with `background` (pass null / TRANSPARENT for a transparent canvas).
 */
async function composeCentered({ canvasSize, contentFraction, background }) {
  const { buffer, width, height, channels } = await loadTrimmedLogo();

  const maxContent = Math.round(canvasSize * contentFraction);
  const scale = Math.min(maxContent / width, maxContent / height);
  const newW = Math.round(width * scale);
  const newH = Math.round(height * scale);

  const resizedLogo = await sharp(buffer, { raw: { width, height, channels } })
    .resize(newW, newH, { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer();

  const canvas = sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: background ?? TRANSPARENT,
    },
  });

  return canvas
    .composite([
      {
        input: resizedLogo,
        left: Math.round((canvasSize - newW) / 2),
        top: Math.round((canvasSize - newH) / 2),
      },
    ])
    .png();
}

/**
 * Produce a pure-white silhouette of the logo on a transparent canvas,
 * suitable for an Android notification icon or adaptive-icon monochrome layer.
 */
async function composeWhiteSilhouette({ canvasSize, contentFraction }) {
  const { buffer, width, height, channels } = await loadTrimmedLogo();

  const maxContent = Math.round(canvasSize * contentFraction);
  const scale = Math.min(maxContent / width, maxContent / height);
  const newW = Math.round(width * scale);
  const newH = Math.round(height * scale);

  // Encode to PNG first so we can decode cleanly into raw pixels at the target size.
  const resizedPng = await sharp(buffer, { raw: { width, height, channels } })
    .resize(newW, newH, { fit: "contain", background: TRANSPARENT })
    .ensureAlpha()
    .png()
    .toBuffer();

  // Threshold the luminance: pixels brighter than ~dark-grey become opaque white,
  // near-black pixels become transparent. This turns the colourful logo-on-black
  // into a clean white silhouette of the logo artwork.
  const { data, info } = await sharp(resizedPng).raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const r = data[i * info.channels + 0];
    const g = data[i * info.channels + 1];
    const b = data[i * info.channels + 2];
    const a = info.channels === 4 ? data[i * info.channels + 3] : 255;
    // Luminance — standard Rec. 601 weights.
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const opaque = a > 20 && lum > 35;
    out[i * 4 + 0] = 255;
    out[i * 4 + 1] = 255;
    out[i * 4 + 2] = 255;
    out[i * 4 + 3] = opaque ? 255 : 0;
  }
  const silhouette = await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();

  const canvas = sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: TRANSPARENT,
    },
  });

  return canvas
    .composite([
      {
        input: silhouette,
        left: Math.round((canvasSize - info.width) / 2),
        top: Math.round((canvasSize - info.height) / 2),
      },
    ])
    .png();
}

async function main() {
  const outputs = [];

  // 1. Main app icon — black square with the logo at ~90% of the canvas.
  //    iOS applies its own rounded-corner mask, so ~5% margin keeps edges clean.
  const iconPath = path.join(imagesDir, "icon.png");
  await (
    await composeCentered({ canvasSize: 1024, contentFraction: 0.9, background: BRAND_BLACK })
  ).toFile(iconPath);
  outputs.push(iconPath);

  // 2. Adaptive icon foreground — transparent canvas, logo at 62% so the whole
  //    logo (brand + tagline) sits safely inside the Android mask's inner 66%.
  const foregroundPath = path.join(imagesDir, "adaptive-icon-foreground.png");
  await (
    await composeCentered({ canvasSize: 1024, contentFraction: 0.62, background: TRANSPARENT })
  ).toFile(foregroundPath);
  outputs.push(foregroundPath);

  // 3. Adaptive icon monochrome (Android 13+ themed-icon) — white silhouette.
  const monochromePath = path.join(imagesDir, "adaptive-icon-monochrome.png");
  await (
    await composeWhiteSilhouette({ canvasSize: 1024, contentFraction: 0.62 })
  ).toFile(monochromePath);
  outputs.push(monochromePath);

  // 4. Splash screen logo — same as the main icon's content but on transparent
  //    so the splash-screen backgroundColor shows through.
  const splashPath = path.join(imagesDir, "splash-icon.png");
  await (
    await composeCentered({ canvasSize: 1024, contentFraction: 0.7, background: TRANSPARENT })
  ).toFile(splashPath);
  outputs.push(splashPath);

  // 5. Push-notification icon — Android expects a small white-on-transparent
  //    silhouette. We generate at 96x96 which is the recommended baseline.
  const notifPath = path.join(imagesDir, "notification-icon.png");
  await (
    await composeWhiteSilhouette({ canvasSize: 96, contentFraction: 0.9 })
  ).toFile(notifPath);
  outputs.push(notifPath);

  // 6. Web favicon — small colour version.
  const faviconPath = path.join(imagesDir, "favicon.png");
  await (
    await composeCentered({ canvasSize: 64, contentFraction: 0.9, background: BRAND_BLACK })
  ).toFile(faviconPath);
  outputs.push(faviconPath);

  console.log("Generated:");
  outputs.forEach((p) => {
    const size = fs.statSync(p).size;
    console.log(`  ${path.relative(rootDir, p)}  (${(size / 1024).toFixed(1)} KB)`);
  });
  console.log("\nDone. Next:");
  console.log("  1. Make sure app.config.js points at these files.");
  console.log("  2. Run `npm run prebuild:android` to regenerate the native mipmaps.");
  console.log("  3. Run `npm run build:apk` to rebuild the APK with the new icon.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
