/**
 * The shell's own rail icons, as SVG text drawn by `MaskIcon` like the ones
 * extensions bring with `View.icon`: solid shapes, holes cut with evenodd.
 */
const svg = (body: string) => `<svg viewBox="0 0 24 24">${body}</svg>`;

/** Four tiles, the top-right one round. */
export const extensionsIcon = svg(
  '<rect x="3" y="3" width="8" height="8" rx="2.4"/><circle cx="17" cy="7" r="4"/><rect x="3" y="13" width="8" height="8" rx="2.4"/><rect x="13" y="13" width="8" height="8" rx="2.4"/>',
);

/** A cog: a toothed ring around a disc with a hole. */
export const settingsIcon = svg(
  '<circle cx="12" cy="12" r="8" fill="none" stroke="#000" stroke-width="3" stroke-dasharray="3.1416 3.1416"/><path fill-rule="evenodd" d="M12 5a7 7 0 1 0 0 14a7 7 0 1 0 0-14ZM12 9.4a2.6 2.6 0 1 1 0 5.2a2.6 2.6 0 1 1 0-5.2Z"/>',
);

/** A window, for a workspace without a usable icon of its own. */
export const workspaceIcon = svg(
  '<path fill-rule="evenodd" d="M6.5 4h11A3.5 3.5 0 0 1 21 7.5v9a3.5 3.5 0 0 1-3.5 3.5h-11A3.5 3.5 0 0 1 3 16.5v-9A3.5 3.5 0 0 1 6.5 4ZM6 9.5v7h12v-7Z"/>',
);
