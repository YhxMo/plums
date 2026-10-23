import { ContractError } from "./errors";
import { identifier, object, string } from "./validation";
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
/**
 * The shell's layout colours. A palette may name any of them; the shell
 * derives the rest from the required colours above.
 */
export const optionalThemeColorNames = [
  "chrome",
  "chat",
  "bubble",
  "row-pinned",
  "selection",
  "selection-text",
  "rail-icon",
] as const;
export type Appearance = "light" | "dark";
export type ThemeColors = Record<(typeof themeColorNames)[number], string> &
  Partial<Record<(typeof optionalThemeColorNames)[number], string>>;
const known: readonly string[] = [
  ...themeColorNames,
  ...optionalThemeColorNames,
];
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
  identifier(id, "extension.invalid", check("theme.id"));
  string(label, "extension.invalid", { ...check("theme.label"), max: 80 });
  if (
    ["light", "dark"].includes(id) ||
    !label.trim() ||
    !["light", "dark"].includes(appearance)
  )
    return invalid();
  object(rawColors, "extension.invalid", check("theme.colors"));
  if (
    Object.keys(rawColors).some((key) => !known.includes(key)) ||
    themeColorNames.some((key) => !Object.hasOwn(rawColors, key))
  )
    return invalid();
  const names = known.filter((key) => Object.hasOwn(rawColors, key));
  const colors = Object.fromEntries(
    names.map((k) => [k, rawColors[k as keyof ThemeColors]]),
  ) as ThemeColors;
  for (const key of names)
    string(colors[key as keyof ThemeColors], "extension.invalid", {
      path: `theme.colors.${key}`,
      label: "Invalid theme contribution",
      pattern:
        key === "shadow" ? /^#[0-9a-f]{6}([0-9a-f]{2})?$/i : /^#[0-9a-f]{6}$/i,
    });
  return { id, label, appearance, colors };
}
