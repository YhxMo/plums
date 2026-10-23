/** One default avatar: the plum's colour and its tile behind it in each mode. */
export type Plum = { body: string; light: string; dark: string };

/** Teal, orange, blue, pink and purple plums; a name picks one. */
export const plumPalette: readonly Plum[] = [
  { body: "#36A3A0", light: "#DDF3F2", dark: "#1F3B3A" },
  { body: "#F57D4A", light: "#FFE9DD", dark: "#4A2E22" },
  { body: "#4A8BD6", light: "#E1EDFA", dark: "#22344A" },
  { body: "#E46A8E", light: "#FCE6EC", dark: "#4A2733" },
  { body: "#7A4FB5", light: "#ECE3F7", dark: "#352A48" },
];

/** The parts every plum shares: stem, leaf and eyes. */
export const plumParts = { stem: "#6B4A2B", leaf: "#4E9F55", eye: "#1A1A1A" };

/** The plum a name keeps, the same on every start (FNV-1a over code points). */
export function plumFor(name: string, palette = plumPalette) {
  let hash = 0x811c9dc5;
  for (const char of name.trim())
    hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0;
  return palette[hash % palette.length];
}
