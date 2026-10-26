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
  for (const name of ["icon.png", "icon.icns"])
    cpSync(join(output, name), join(root, "src-tauri/icons", name), {
      recursive: true,
    });
  mkdirSync(join(root, "public/brand"), { recursive: true });
  cpSync(join(output, "128x128.png"), join(root, "public/brand/plums.png"));
  writeFileSync(
    join(root, "public/brand/plums-dark.png"),
    buildDarkIcon(readFileSync(join(root, "public/brand/plums.png"))),
  );
  console.log("Updated macOS and web icons from source.png.");
}
