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

/** The plum's shapes on a 48 × 48 tile, shared by the mark and its picture. */
export const plumShape = {
  tileRadius: 13,
  body: { cx: 24, cy: 28.5, r: 14 },
  stem: "M24 15c0-3.5 1-5.5 2.5-7",
  leaf: "M26 11.5c2.5-3.5 7-4.5 10-3.5-1 3.5-5.5 5.5-10 3.5z",
  eyes: [19.5, 28.5],
  eye: { cy: 28, rx: 1.8, ry: 2.6 },
};

/** The light-mode plum for `name` as a standalone SVG, for pictures. */
export function plumSvg(name: string) {
  const plum = plumFor(name);
  const { tileRadius, body, stem, leaf, eyes, eye } = plumShape;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="512" height="512"><rect width="48" height="48" rx="${tileRadius}" fill="${plum.light}"/><circle cx="${body.cx}" cy="${body.cy}" r="${body.r}" fill="${plum.body}"/><path d="${stem}" stroke="${plumParts.stem}" stroke-width="2" stroke-linecap="round" fill="none"/><path d="${leaf}" fill="${plumParts.leaf}"/>${eyes.map((cx) => `<ellipse cx="${cx}" cy="${eye.cy}" rx="${eye.rx}" ry="${eye.ry}" fill="${plumParts.eye}"/>`).join("")}</svg>`;
}
