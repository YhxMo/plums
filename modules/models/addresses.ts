import type { Protocol } from "./protocols";

/** Path each protocol posts to, appended to the base URL. */
const chatPath: Record<Protocol, string> = {
  "openai-chat": "/chat/completions",
  "anthropic-messages": "/v1/messages",
};
const version = /\/v\d+$/;
/** Sub-paths of compatibility gateways; the list is also tried without them (after cc-switch). */
const compatSuffixes = [
  "/api/claudecode",
  "/api/anthropic",
  "/apps/anthropic",
  "/api/coding",
  "/claudecode",
  "/anthropic",
  "/step_plan",
  "/coding",
  "/claude",
];

/**
 * The base URL as the provider's docs give it: without a trailing slash or
 * the chat path, so a pasted full address works too.
 */
export function normalizeBase(protocol: Protocol, input: string) {
  let base = input.trim();
  try {
    // Lower-case scheme and host as the native check expects.
    const url = new URL(base);
    if (!url.search && !url.hash) base = url.origin + url.pathname;
  } catch {
    // Left as typed; the draft check explains what is wrong.
  }
  base = base.replace(/\/+$/, "");
  const paths =
    protocol === "anthropic-messages"
      ? ["/v1/messages", "/messages"]
      : ["/chat/completions"];
  for (const path of paths)
    if (base.endsWith(path)) {
      base = base.slice(0, -path.length);
      break;
    }
  return base;
}

/** Where chat requests go; this is the address the user confirms natively. */
export function chatTarget(protocol: Protocol, base: string) {
  return protocol === "anthropic-messages" && version.test(base)
    ? `${base}/messages`
    : `${base}${chatPath[protocol]}`;
}

/** Paths on the base URL's site that may list models, most likely first. */
export function modelListPaths(protocol: Protocol, base: string) {
  const path = new URL(base).pathname.replace(/\/+$/, "");
  const candidates = (prefix: string) =>
    version.test(prefix)
      ? [`${prefix}/models`]
      : protocol === "openai-chat"
        ? [`${prefix}/models`, `${prefix}/v1/models`]
        : [`${prefix}/v1/models`];
  const paths = candidates(path);
  const suffix = compatSuffixes.find((item) => path.endsWith(item));
  if (suffix) {
    const root = path.slice(0, -suffix.length);
    paths.push(`${root}/v1/models`, `${root}/models`);
  }
  return [...new Set(paths)];
}

/** Model ids from `data[].id` (OpenAI, Anthropic) or `models[].slug|id`; sorted, unique. */
export function readModelList(body: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const { data, models } = parsed as Record<string, unknown>;
  const entries = [
    ...(Array.isArray(data) ? data : []),
    ...(Array.isArray(models) ? models : []),
  ];
  const ids = entries.flatMap((entry) => {
    const { slug, id } = (entry ?? {}) as Record<string, unknown>;
    const value = typeof slug === "string" ? slug : id;
    return typeof value === "string" &&
      value &&
      value.length <= 120 &&
      value === value.trim()
      ? [value]
      : [];
  });
  return [...new Set(ids)].sort();
}
