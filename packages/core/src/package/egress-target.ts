export interface EgressTarget {
  /** `*.example.com`: any subdomain of `host`, but not `host` itself. */
  wildcard: boolean;
  /** Lower case, punycode. */
  host: string;
  port: string;
}

const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const IPV4_PATTERN = /^\d+(\.\d+){0,3}$/;

/**
 * Reads an egress `target`: a host name with an optional port, or a leading `*.` plus a host name.
 * The host part needs at least two labels (`com`, `*.com` and any other `*` are refused).
 * IP literals, `localhost` and `*.localhost` are refused by the host string. No DNS lookup.
 * Returns `undefined` when the text breaks a rule.
 */
export function parseEgressTarget(target: string): EgressTarget | undefined {
  const wildcard = target.startsWith("*.");
  const match = /^([^:/?#@\s]+)(?::(\d{1,5}))?$/.exec(wildcard ? target.slice(2) : target);
  if (match === null || match[1] === undefined) {
    return undefined;
  }
  let host: string;
  try {
    host = new URL(`https://${match[1]}`).hostname;
  } catch {
    return undefined;
  }
  const port = match[2] ?? "443";
  const bad =
    !HOST_PATTERN.test(host) ||
    blockedEgressHost(host) ||
    host.split(".").length < 2 ||
    Number(port) < 1 ||
    Number(port) > 65535;
  return bad ? undefined : { wildcard, host, port: String(Number(port)) };
}

/** IP literal, `localhost`, or a name ending in `.localhost`. The characters only; no DNS. */
function blockedEgressHost(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || IPV4_PATTERN.test(host);
}

/**
 * Returns the parsed `url` if it is allowed by `target`: https only, no user or password, host and port match.
 * Path and query do not count. A host with an empty label (`.good.com`, `a..good.com`) is refused.
 */
export function matchEgressUrl(target: string, url: string): URL | undefined {
  const rule = parseEgressTarget(target);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  // The same host rules as a declared target: empty labels, IP literals, localhost, `*.localhost`.
  const hostMatches =
    parseEgressTarget(parsed.hostname) !== undefined &&
    (rule?.wildcard ? parsed.hostname.endsWith(`.${rule.host}`) : parsed.hostname === rule?.host);
  const allowed =
    rule !== undefined &&
    hostMatches &&
    parsed.protocol === "https:" &&
    parsed.username === "" &&
    parsed.password === "" &&
    (parsed.port || "443") === rule.port;
  return allowed ? parsed : undefined;
}

export type HttpsUrlFailure = "INVALID_URL" | "NOT_HTTPS" | "USERINFO" | "IP_LITERAL" | "TRAILING_DOT" | "LOCALHOST";

/**
 * Share-link check only: https, no username or password, host is not an IP literal,
 * a name ending in `.`, or `localhost` / `*.localhost`. It does not match an egress target.
 * A trailing dot is checked first, so `localhost.` is TRAILING_DOT, not LOCALHOST. No DNS.
 */
export function checkHttpsUrl(url: string): URL | HttpsUrlFailure {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "INVALID_URL";
  }
  if (parsed.protocol !== "https:") return "NOT_HTTPS";
  if (parsed.username !== "" || parsed.password !== "") return "USERINFO";
  const host = parsed.hostname;
  if (host.endsWith(".")) return "TRAILING_DOT";
  if (host === "localhost" || host.endsWith(".localhost")) return "LOCALHOST";
  if (isIpLiteral(host)) return "IP_LITERAL";
  return parsed;
}

/** A declared egress target whose host ends in `.` (`share.example.`, `*.localhost.`). */
export function isTrailingDotTarget(target: string): boolean {
  return target.replace(/:\d{1,5}$/, "").endsWith(".");
}

function isIpLiteral(hostname: string): boolean {
  const bare = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return bare.includes(":") || IPV4_PATTERN.test(bare);
}
