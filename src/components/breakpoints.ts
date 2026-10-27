/**
 * Layout widths, the same values as the `--breakpoint-*` theme variables in
 * app.css (Tailwind `md:` / `max-md:` and so on); tests keep them equal.
 */
export const breakpoints = {
  /** Dialog forms stack their two-column rows. */
  form: "32.5rem",
  /** Two panes: 68px rail + 208px list + 8px gap + 360px chat + 8px inset. */
  md: "40.75rem",
  /** Room for the Agent details beside the conversation. */
  wide: "68.75rem",
} as const;
export type Breakpoint = keyof typeof breakpoints;

export const below = (name: Breakpoint) => `(width < ${breakpoints[name]})`;
export const atLeast = (name: Breakpoint) => `(width >= ${breakpoints[name]})`;
