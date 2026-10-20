import { ContractError } from "./errors";

/**
 * Experimental: the Mac and Android apps GET a public HTTPS resource with no
 * credentials, cookies or redirects; browsers do not provide it. The URL's
 * origin must be one the manifest lists in `networkSources`.
 */
export interface NetworkReadRequest {
  version: 1;
  /** Absolute `https://` URL on a declared source, at most 2048 characters; a query is allowed, a fragment is not. */
  url: string;
}
export interface NetworkReadResponse {
  status: number;
  /** UTF-8 text, at most 16 MiB. No response headers. */
  body: string;
}

export const MAX_NETWORK_SOURCES = 8;
/** A DNS host name with a dot; IP literals and `localhost` never match. */
const hostName =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** The origin of a public HTTPS URL on the default port, or undefined. */
export function networkOrigin(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  return parsed.protocol === "https:" &&
    !parsed.username &&
    !parsed.password &&
    !parsed.port &&
    hostName.test(parsed.hostname)
    ? parsed.origin
    : undefined;
}

/** Sources are bare origins such as `https://models.dev`; they need `network.read`. */
export function validateNetworkSources(
  value: unknown,
  capabilities: readonly string[] = [],
): asserts value is string[] | undefined {
  const fail = (path: string) => {
    throw new ContractError(
      "extension.invalid",
      path,
      "Invalid network source declaration",
    );
  };
  const declared = capabilities.includes("network.read");
  if (value === undefined) {
    if (declared) fail("networkSources");
    return;
  }
  if (
    !declared ||
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_NETWORK_SOURCES ||
    new Set(value).size !== value.length
  )
    fail("networkSources");
  (value as unknown[]).forEach((source, index) => {
    if (typeof source !== "string" || networkOrigin(source) !== source)
      fail(`networkSources.${index}`);
  });
}
