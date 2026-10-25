/**
 * PNG text chunks, where picture role cards keep their data: Character Card
 * V2 in a `chara` tEXt chunk and V3 in `ccv3`, each base64 of UTF-8 JSON.
 * Written from the PNG specification; no tavern code is copied.
 */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export const isPng = (bytes: Uint8Array) =>
  SIGNATURE.every((byte, i) => bytes[i] === byte);

let table: Uint32Array | undefined;
function crc32(bytes: Uint8Array) {
  table ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  let c = ~0;
  for (const byte of bytes) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

type Chunk = { type: string; data: Uint8Array; start: number; end: number };

function* chunks(png: Uint8Array): Generator<Chunk> {
  if (!isPng(png)) throw new Error("不是 PNG 图片。");
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  while (at + 12 <= png.length) {
    const length = view.getUint32(at);
    const end = at + 12 + length;
    if (end > png.length) throw new Error("PNG 图片不完整。");
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    yield { type, data: png.subarray(at + 8, at + 8 + length), start: at, end };
    if (type === "IEND") return;
    at = end;
  }
}

const latin1 = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

/** The keyword and text of each tEXt chunk, in order. */
export function pngTextChunks(png: Uint8Array): Map<string, string> {
  const found = new Map<string, string>();
  for (const { type, data } of chunks(png)) {
    if (type !== "tEXt") continue;
    const split = data.indexOf(0);
    if (split > 0)
      found.set(
        latin1(data.subarray(0, split)),
        latin1(data.subarray(split + 1)),
      );
  }
  return found;
}

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * The PNG with these tEXt chunks before its end, replacing chunks of the
 * same keywords. Keywords and text must be Latin-1 (base64 is).
 */
export function withPngText(
  png: Uint8Array,
  entries: Record<string, string>,
): Uint8Array<ArrayBuffer> {
  const kept: Uint8Array[] = [png.subarray(0, 8)];
  let end: Uint8Array | undefined;
  for (const c of chunks(png)) {
    const whole = png.subarray(c.start, c.end);
    if (c.type === "IEND") end = whole;
    else if (c.type === "tEXt") {
      const keyword = latin1(c.data.subarray(0, c.data.indexOf(0)));
      if (!Object.hasOwn(entries, keyword)) kept.push(whole);
    } else kept.push(whole);
  }
  if (!end) throw new Error("PNG 图片不完整。");
  for (const [keyword, text] of Object.entries(entries))
    kept.push(
      chunk(
        "tEXt",
        Uint8Array.from(`${keyword}\0${text}`, (c) => c.charCodeAt(0)),
      ),
    );
  kept.push(end);
  const out = new Uint8Array(kept.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of kept) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Bytes as base64, in slices that stay within the call stack. */
export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
/** UTF-8 text as base64, for a chunk. */
export const toBase64 = (text: string) =>
  bytesToBase64(new TextEncoder().encode(text));
export const fromBase64 = (value: string) =>
  new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(atob(value), (c) => c.charCodeAt(0)),
  );
