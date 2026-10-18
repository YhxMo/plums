import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++)
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

/** @param {Uint8Array} bytes */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} type
 * @param {Buffer} data
 */
function pngChunk(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])), 0);
  return Buffer.concat([header, data, tail]);
}

/** @typedef {{ width: number, height: number, pixels: Buffer }} Image */

/**
 * Decodes the 8-bit RGBA, non-interlaced PNGs this script reads.
 * @param {Buffer} png
 * @returns {Image}
 */
export function decodePng(png) {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0)
        throw new Error("Icon sources must be 8-bit RGBA PNG");
    } else if (type === "IDAT") idat.push(data);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(height * stride);
  const prev = Buffer.alloc(stride);
  let cursor = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[cursor++];
    const line = Buffer.from(raw.subarray(cursor, cursor + stride));
    cursor += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? line[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 0xff;
      else if (filter === 2) line[x] = (line[x] + b) & 0xff;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        line[x] = (line[x] + pr) & 0xff;
      }
    }
    line.copy(pixels, y * stride);
    line.copy(prev);
  }
  return { width, height, pixels };
}

/** @param {Image} image */
function encodePng({ width, height, pixels }) {
  const stride = width * 4;
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.from([0]), pixels.subarray(y * stride, (y + 1) * stride));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** @type {(r: number, g: number, b: number) => boolean} */
const isOrange = (r, g, b) =>
  r > 140 && g < r * 0.72 && b < g * 0.72 && r - g > 55;

/** @param {Buffer} lightPng */
export function buildDarkIcon(lightPng) {
  const image = decodePng(lightPng);
  const { pixels } = image;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];
    if (a === 0) continue;
    if (!isOrange(r, g, b) && r > 178 && g > 178 && b > 178) {
      const lum = (r + g + b) / 3;
      const shade = Math.round(0x20 + ((lum - 178) / (255 - 178)) * 12);
      pixels[i] = shade;
      pixels[i + 1] = shade;
      pixels[i + 2] = shade;
    }
  }
  return encodePng(image);
}

/**
 * Adaptive-icon foreground: only the orange mark, without the macOS tile and
 * shadow, centred at `share` of the canvas so launcher masks never crop it
 * (the guaranteed visible zone is 66 of 108 dp).
 * @param {Buffer} sourcePng
 * @param {number} size
 */
export function buildAndroidForeground(sourcePng, size, share = 0.46) {
  const source = decodePng(sourcePng);
  const { width, height } = source;
  // Separate the mark from the near-white tile: its alpha follows how far a
  // pixel moved from white toward orange, then the colour is un-blended.
  const mark = new Float64Array(width * height * 4);
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, , b, a] = source.pixels.subarray(i, i + 4);
      const alpha = Math.min(1, Math.max(0, (r - b - 12) / 150)) * (a / 255);
      if (alpha <= 0) continue;
      for (let c = 0; c < 3; c++) {
        const value = (source.pixels[i + c] - (1 - alpha) * 255) / alpha;
        mark[i + c] = Math.min(255, Math.max(0, value)) * alpha;
      }
      mark[i + 3] = alpha;
      // Faint glow does not count toward the mark's extent.
      if (alpha < 0.25) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  if (right < 0) throw new Error("The icon source has no orange mark");
  const extent = Math.max(right - left + 1, bottom - top + 1);
  const scale = (size * share) / extent;
  const offsetX = (size - (right - left + 1) * scale) / 2 - left * scale;
  const offsetY = (size - (bottom - top + 1) * scale) / 2 - top * scale;
  // Area-average downsampling of premultiplied colour.
  const sums = new Float64Array(size * size * 5);
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++) {
      const i = (y * width + x) * 4;
      const tx = Math.floor(x * scale + offsetX);
      const ty = Math.floor(y * scale + offsetY);
      const o = (ty * size + tx) * 5;
      for (let c = 0; c < 4; c++) sums[o + c] += mark[i + c];
      sums[o + 4]++;
    }
  const pixels = Buffer.alloc(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    const alpha = sums[p * 5 + 4] ? sums[p * 5 + 3] / sums[p * 5 + 4] : 0;
    if (!alpha) continue;
    const covered = sums[p * 5 + 3];
    for (let c = 0; c < 3; c++)
      pixels[p * 4 + c] = Math.round(sums[p * 5 + c] / covered);
    pixels[p * 4 + 3] = Math.round(alpha * 255);
  }
  return encodePng({ width: size, height: size, pixels });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const output = join(root, ".cache/icon-generation");
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/@tauri-apps/cli/tauri.js",
      "icon",
      "src-tauri/icons/source.png",
      "--output",
      output,
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `Icon generation failed: ${result.status ?? result.signal}`,
    );
  for (const name of ["icon.png", "icon.icns", "android"])
    cpSync(join(output, name), join(root, "src-tauri/icons", name), {
      recursive: true,
    });
  for (const name of [
    "mipmap-anydpi-v26/ic_launcher.xml",
    "values/ic_launcher_background.xml",
  ]) {
    const path = join(root, "src-tauri/icons/android", name);
    writeFileSync(path, readFileSync(path, "utf8").trimEnd() + "\n");
  }
  const foregroundSizes = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
  };
  const source = readFileSync(join(root, "src-tauri/icons/source.png"));
  for (const [density, size] of Object.entries(foregroundSizes))
    writeFileSync(
      join(
        root,
        "src-tauri/icons/android",
        density,
        "ic_launcher_foreground.png",
      ),
      buildAndroidForeground(source, size),
    );
  mkdirSync(join(root, "extensions/brand"), { recursive: true });
  cpSync(join(output, "128x128.png"), join(root, "extensions/brand/plums.png"));
  writeFileSync(
    join(root, "extensions/brand/plums-dark.png"),
    buildDarkIcon(readFileSync(join(root, "extensions/brand/plums.png"))),
  );
  console.log("Updated macOS, Android and web icons from source.png.");
}
