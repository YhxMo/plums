/** One default avatar: the plum's colour and its tile behind it in each mode. */
export type Plum = { body: string; light: string; dark: string };

/**
 * Teal, orange, blue, pink and purple plums; a name picks one. Radix
 * Colors: the plum is step 9, its tile step 4 of the light or dark scale.
 */
export const plumPalette: readonly Plum[] = [
  { body: "#12A594", light: "#CCF3EA", dark: "#023B37" },
  { body: "#F76B15", light: "#FFDFB5", dark: "#462100" },
  { body: "#0090FF", light: "#D5EFFF", dark: "#003362" },
  { body: "#D6409F", light: "#FBDCEF", dark: "#4B143D" },
  { body: "#8E4EC6", light: "#F2E2FC", dark: "#3D224E" },
];

/** The parts every plum shares: stem (Brown 11), leaf (Grass 9) and eyes (Gray 12). */
export const plumParts = { stem: "#815E46", leaf: "#46A758", eye: "#202020" };

/** The plum a name keeps, the same on every start (FNV-1a over code points). */
export function plumFor(name: string, palette = plumPalette) {
  let hash = 0x811c9dc5;
  for (const char of name.trim())
    hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0;
  return palette[hash % palette.length];
}
