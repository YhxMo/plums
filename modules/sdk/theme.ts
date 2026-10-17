import { ContractError } from "./errors";
import { object, string } from "./validation";
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
    throw new ContractError(
      "extension.invalid",
      "theme",
      "Invalid theme contribution",
    );
  };
  const check = (path: string) => ({
    path,
    label: "Invalid theme contribution",
  });
  object(input, "extension.invalid", check("theme"));
  if (
    Object.keys(input).some(
      (key) => !["id", "label", "appearance", "colors"].includes(key),
    )
  )
    return invalid();
  const { id, label, appearance, colors: rawColors } = input;
  string(id, "extension.invalid", {
    ...check("theme.id"),
    pattern: /^[a-z][a-z0-9.-]{0,63}$/,
  });
  string(label, "extension.invalid", { ...check("theme.label"), max: 80 });
  if (
    id.includes("..") ||
    ["light", "dark"].includes(id) ||
    !label.trim() ||
    !["light", "dark"].includes(appearance)
  )
    return invalid();
  object(rawColors, "extension.invalid", check("theme.colors"));
  if (
    Object.keys(rawColors).length !== themeColorNames.length ||
    Object.keys(rawColors).some(
      (key) => !themeColorNames.includes(key as keyof ThemeColors),
    )
  )
    return invalid();
  const colors = Object.fromEntries(
    themeColorNames.map((k) => [k, rawColors[k]]),
  ) as ThemeColors;
  for (const key of themeColorNames)
    string(colors[key], "extension.invalid", {
      path: `theme.colors.${key}`,
      label: "Invalid theme contribution",
      pattern:
        key === "shadow" ? /^#[0-9a-f]{6}([0-9a-f]{2})?$/i : /^#[0-9a-f]{6}$/i,
    });
  return { id, label, appearance, colors };
}
