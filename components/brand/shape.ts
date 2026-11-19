// Brand geometry: the doorway silhouette (from the logo's n) and where the sprout sits on it.
import { radius } from "../../constants/ui";
import { SPROUT } from "./brand";

/** Doorway corners from the logo's n: small top-left, a full curve top-right, small bottoms. */
export function doorwayRadii(width: number) {
  const r = width >= 64 ? radius.xl : radius.md; // 12 or 8
  return {
    borderTopLeftRadius: r,
    borderTopRightRadius: width / 2,
    borderBottomLeftRadius: r,
    borderBottomRightRadius: r,
  };
}

/** Sprout above a frame's top-left corner. 80 → 35 x 21, lift 4, overhang 25. 112 → 49 x 29, lift 6, overhang 35. */
export function sproutOnFrame(width: number) {
  const w = Math.round(width * 0.44);
  const h = Math.round(w / SPROUT.aspect);
  const lift = Math.round(width * 0.05);
  return { width: w, height: h, left: 0, top: -(h + lift), overhang: h + lift };
}
