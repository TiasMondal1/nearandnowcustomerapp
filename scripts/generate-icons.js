#!/usr/bin/env node
/**
 * Generate every app icon / splash variant from the brand sources in assets/brand/
 * (the "doorway n" logo pack, 2026-11). Run: npm run icons:generate
 *
 * Inputs (assets/brand/, copied verbatim from the logo pack — do not edit by hand):
 *   icon-square-1024.png          saffron square, cream mark — store / iOS / legacy Android icon
 *   adaptive-foreground-1024.png  cream mark on transparent, already inside the adaptive safe zone
 *   mark-mono-white.png           the mark alone, white on transparent
 *   logo-stacked.png              mark above the name — the in-app logo and the splash artwork
 *   favicon-96.png                rounded saffron tile for the web tab
 *
 * Outputs (assets/images/, 1024x1024 unless noted) — the paths app.config.js points at:
 *   icon.png                      main app icon (iOS + legacy Android)
 *   adaptive-icon-foreground.png  Android adaptive foreground (background colour #E85D0F is set in app.config.js)
 *   adaptive-icon-monochrome.png  Android 13+ themed-icon layer (white silhouette of the foreground)
 *   splash-icon.png               splash artwork: the stacked logo inside the centre 62 % of a transparent square
 *   notification-icon.png         96x96 white silhouette of the mark for push notifications
 *   favicon.png                   96x96 web favicon
 *
 * Why the splash logo sits in the centre 62 %: Android 12+ masks the splash icon to a circle
 * two-thirds the icon box wide, so anything outside that is cropped. app/index.tsx draws the same
 * logo at the matching size (SPLASH_IMAGE_WIDTH * SPLASH_CONTENT_FRACTION) so the hand-off is invisible.
 */
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

const rootDir = path.resolve(__dirname, "..");
const brandDir = path.join(rootDir, "assets", "brand");
const imagesDir = path.join(rootDir, "assets", "images");

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
/** Keep in sync with the logo size in app/index.tsx. */
const SPLASH_CONTENT_FRACTION = 0.62;

const src = (name) => {
  const file = path.join(brandDir, name);
  if (!fs.existsSync(file)) {
    console.error("Brand source not found:", file);
    process.exit(1);
  }
  return file;
};

/** Centre `input` on a transparent square, its longest edge `contentFraction` of the canvas. */
async function composeCentered({ input, canvasSize, contentFraction }) {
  const box = Math.round(canvasSize * contentFraction);
  const resized = await sharp(input)
    .resize(box, box, { fit: "inside", background: TRANSPARENT })
    .png()
    .toBuffer();
  return sharp({ create: { width: canvasSize, height: canvasSize, channels: 4, background: TRANSPARENT } })
    .composite([{ input: resized, gravity: "centre" }])
    .png();
}

/** Same pixels, every one painted white: the alpha channel alone carries the shape. */
async function whiteSilhouette(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < info.width * info.height; i++) {
    data[i * 4] = 255;
    data[i * 4 + 1] = 255;
    data[i * 4 + 2] = 255;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png();
}

async function main() {
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
  const out = (name) => path.join(imagesDir, name);
  const outputs = [];
  const write = async (pipeline, name) => {
    await pipeline.toFile(out(name));
    outputs.push(out(name));
  };

  // 1. Main icon — the pack's square, flattened so iOS never sees an alpha channel.
  await write(sharp(src("icon-square-1024.png")).resize(1024, 1024).flatten({ background: "#E85D0F" }).png(), "icon.png");

  // 2. Adaptive foreground — verbatim; the pack already keeps it inside the safe zone.
  await write(sharp(src("adaptive-foreground-1024.png")).resize(1024, 1024).png(), "adaptive-icon-foreground.png");

  // 3. Themed-icon layer — the foreground's shape in white.
  await write(await whiteSilhouette(await sharp(src("adaptive-foreground-1024.png")).resize(1024, 1024).png().toBuffer()), "adaptive-icon-monochrome.png");

  // 4. Splash artwork.
  await write(
    await composeCentered({ input: src("logo-stacked.png"), canvasSize: 1024, contentFraction: SPLASH_CONTENT_FRACTION }),
    "splash-icon.png",
  );

  // 5. Notification icon — Android tints it, so only the alpha matters.
  const notif = await composeCentered({ input: src("mark-mono-white.png"), canvasSize: 96, contentFraction: 0.92 });
  await write(await whiteSilhouette(await notif.toBuffer()), "notification-icon.png");

  // 6. Web favicon.
  await write(sharp(src("favicon-96.png")).resize(96, 96).png(), "favicon.png");

  console.log("Generated:");
  outputs.forEach((p) => console.log("  " + path.relative(rootDir, p)));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
