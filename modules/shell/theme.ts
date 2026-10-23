import {
  optionalThemeColorNames,
  themeColorNames,
  type Appearance,
  type Theme,
} from "@modules/sdk/theme";

/** Applies only registered semantic colors; removing a contribution restores CSS defaults. */
export function applyTheme(
  root: HTMLElement,
  fallback: Appearance,
  theme?: Theme,
) {
  root.dataset.theme = theme?.appearance ?? fallback;
  if (theme) root.dataset.themeId = theme.id;
  else delete root.dataset.themeId;
  // Layout colours a palette leaves out are derived by the stylesheet.
  for (const name of [...themeColorNames, ...optionalThemeColorNames]) {
    const value = theme?.colors[name];
    if (value) root.style.setProperty(`--${name}`, value);
    else root.style.removeProperty(`--${name}`);
  }
}
