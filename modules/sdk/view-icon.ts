/** Largest `View.icon` the host draws, in UTF-8 bytes. */
export const VIEW_ICON_LIMIT = 8 * 1024;

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';

/**
 * Why a `View.icon` cannot be drawn, or undefined when it can: SVG text whose
 * root is `<svg>` with a four-number `viewBox`, within the size limit. The
 * host draws it only as a CSS mask, so its scripts, links and styles never
 * run; this check is about whether there is a shape to draw.
 */
export function viewIconProblem(icon: unknown): string | undefined {
  if (typeof icon !== "string") return "icon must be SVG text";
  if (new TextEncoder().encode(icon).length > VIEW_ICON_LIMIT)
    return `icon exceeds ${VIEW_ICON_LIMIT} bytes`;
  const root = rootTag(icon);
  if (!root) return "icon is not an <svg> element";
  if (!/<\/svg\s*>\s*$/.test(icon.trim()) && !/\/>$/.test(root))
    return "icon is not a complete <svg> element";
  const viewBox = /\sviewBox\s*=\s*(["'])([^"']*)\1/.exec(root)?.[2];
  const numbers = viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!numbers || numbers.length !== 4 || numbers.some((n) => !isFinite(n)))
    return "icon needs a viewBox of four numbers";
  return undefined;
}

/** The icon as a `data:` URL for a CSS mask; SVG images need the namespace. */
export function viewIconUrl(icon: string) {
  const root = rootTag(icon)!;
  const svg = /\sxmlns\s*=/.test(root)
    ? icon
    : icon.replace(/<svg\b/, `<svg ${SVG_NS}`);
  return `url("data:image/svg+xml,${encodeURIComponent(svg.trim())}")`;
}

/** The root start tag, after an optional XML declaration and comments. */
function rootTag(icon: string) {
  return /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(<svg\b[^>]*>)/.exec(
    icon,
  )?.[1];
}
