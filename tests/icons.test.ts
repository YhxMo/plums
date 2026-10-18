import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  buildAndroidForeground,
  buildDarkIcon,
  decodePng,
} from "../scripts/icons.mjs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url));

it("keeps the Android foreground mark inside the launcher safe zone without the tile", () => {
  const size = 108;
  const { pixels } = decodePng(
    buildAndroidForeground(read("../src-tauri/icons/source.png"), size),
  );
  let [left, top, right, bottom] = [size, size, -1, -1];
  let farthest = 0;
  let whiteTile = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixels.subarray((y * size + x) * 4);
      if (a <= 16) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      farthest = Math.max(farthest, Math.hypot(x + 0.5 - 54, y + 0.5 - 54));
      if (a > 200 && r > 230 && g > 230 && b > 230) whiteTile++;
    }
  expect(Math.max(right - left + 1, bottom - top + 1)).toBeGreaterThan(46);
  expect(Math.max(right - left + 1, bottom - top + 1)).toBeLessThan(53);
  // 66 dp of 108 is guaranteed visible under every launcher mask.
  expect(farthest).toBeLessThan(33);
  expect(whiteTile).toBe(0);
});

it("still derives the committed dark brand mark from the light one", () => {
  expect(
    buildDarkIcon(read("../extensions/brand/plums.png")).equals(
      read("../extensions/brand/plums-dark.png"),
    ),
  ).toBe(true);
});
