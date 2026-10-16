export const themeColorNames = [
  "text",
  "surface",
  "background",
  "card",
  "overlay",
  "subtle",
  "border",
  "control-border",
  "muted",
  "accent",
  "accent-hover",
  "accent-ink",
  "accent-soft",
  "accent-text",
  "error",
  "running",
  "shadow",
] as const;
export type Appearance = "light" | "dark";
export type ThemeColors = Record<(typeof themeColorNames)[number], string>;
export interface Theme {
  id: string;
  label: string;
  appearance: Appearance;
  colors: ThemeColors;
}
/** Validates and copies a static semantic palette. This is not a contrast guarantee. */
export function copyTheme(input: Theme): Theme {
  const invalid = () => {
    throw Error("Invalid theme contribution");
  };
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (k) => !["id", "label", "appearance", "colors"].includes(k),
    )
  )
    return invalid();
  const { id, label, appearance, colors: rawColors } = input;
  if (
    typeof id !== "string" ||
    !/^[a-z][a-z0-9.-]{0,63}$/.test(id) ||
    id.includes("..") ||
    ["light", "dark"].includes(id) ||
    typeof label !== "string" ||
    !label.trim() ||
    label.length > 80 ||
    !["light", "dark"].includes(appearance) ||
    !rawColors ||
    typeof rawColors !== "object" ||
    Array.isArray(rawColors) ||
    Object.keys(rawColors).length !== themeColorNames.length ||
    Object.keys(rawColors).some(
      (k) => !themeColorNames.includes(k as keyof ThemeColors),
    )
  )
    return invalid();
  const colors = Object.fromEntries(
    themeColorNames.map((k) => [k, rawColors[k]]),
  ) as ThemeColors;
  if (
    themeColorNames.some(
      (k) =>
        typeof colors[k] !== "string" ||
        !(
          k === "shadow" ? /^#[0-9a-f]{6}([0-9a-f]{2})?$/i : /^#[0-9a-f]{6}$/i
        ).test(colors[k]),
    )
  )
    return invalid();
  return { id, label, appearance, colors };
}
