/**
 * Experimental: opens a link in the user's default browser; the browser
 * preview opens a new tab instead. Resolves once the link is handed over.
 */
export interface LinkOpenRequest {
  version: 1;
  /** Absolute `https://` URL with a host and no user info, at most 2048 characters. */
  url: string;
}

/** Whether `url` is a link `link.open` accepts. */
export function isOpenableLink(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 2048) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    Boolean(parsed.hostname) &&
    !parsed.username &&
    !parsed.password
  );
}
