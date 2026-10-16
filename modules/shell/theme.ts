import { themeColorNames, type Appearance, type Theme } from "../sdk/theme";

/** Applies only registered semantic colors; removing a contribution restores CSS defaults. */
export function applyTheme(
  root: HTMLElement,
  fallback: Appearance,
  theme?: Theme,
) {
  root.dataset.theme = theme?.appearance ?? fallback;
  if (theme) root.dataset.themeId = theme.id;
  else delete root.dataset.themeId;
  for (const name of themeColorNames) {
    if (theme) root.style.setProperty(`--${name}`, theme.colors[name]);
    else root.style.removeProperty(`--${name}`);
  }
}
