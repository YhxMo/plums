/**
 * Model facts from the public models.dev catalog, found the way cc-switch
 * (MIT) finds them: the service matched by its address first, then the
 * model maker's own entry. Only the context window is used here.
 */
export const CATALOG_SOURCE = "https://models.dev";
export const CATALOG_URL = `${CATALOG_SOURCE}/api.json`;

type Entry = { id: string; context?: number; canonical?: string };
type Service = { endpoint?: string; models: Map<string, Entry> };
export type Catalog = {
  services: Service[];
  byId: Map<string, Service>;
  /** Normalized model id → every service's entry for it. */
  byName: Map<string, { service: string; entry: Entry }[]>;
  /** Services some `canonical_model_id` points at: the model makers. */
  makers: Set<string>;
};

/**
 * Many resellers serve GPT from a ChatGPT subscription and cap it there. A
 * window set too large fails a turn upstream, one too small only trims
 * sooner, so the maker's figure is capped when the service is not known.
 */
export const GPT_WINDOW_CAP = 272_000;

/** Drops a `vendor/` prefix, a `:variant` suffix and a `[1m]` tag. */
export function normalizeModel(id: string) {
  const name = (id.slice(id.lastIndexOf("/") + 1).split(":")[0] ?? "")
    .trim()
    .replace(/@/g, "-")
    .toLowerCase();
  return name.endsWith("[1m]") ? name.slice(0, -4).trim() : name;
}
const isGpt = (id: string) => /(?:^|[^a-z0-9])gpt-/.test(normalizeModel(id));

const version = /^v\d+(?:(?:alpha|beta)\d*)?$/;
/**
 * Host and path without a trailing version (`v1`, `v4`, `v1beta`) or request
 * path (`chat/completions`, `messages`, `responses`). Other path segments
 * must match exactly: `/zen/v1` and `/zen/go/v1` are different plans.
 */
export function endpointKey(url: string): string | undefined {
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
  } catch {
    return undefined;
  }
  const parts = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => part.toLowerCase());
  for (;;) {
    const last = parts.at(-1) ?? "";
    if (last === "completions" && parts.at(-2) === "chat") parts.length -= 2;
    else if (last === "responses" || last === "messages" || version.test(last))
      parts.length -= 1;
    else break;
  }
  return [parsed.hostname.toLowerCase(), ...parts].join("/");
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const positive = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : undefined;

/** Indexes the catalog's JSON text; throws when it is not the expected shape. */
export function readCatalog(text: string): Catalog {
  const data: unknown = JSON.parse(text);
  if (!record(data)) throw new Error("models.dev 数据格式不符");
  const catalog: Catalog = {
    services: [],
    byId: new Map(),
    byName: new Map(),
    makers: new Set(),
  };
  for (const [serviceId, raw] of Object.entries(data)) {
    if (!record(raw) || !record(raw.models)) continue;
    const service: Service = {
      endpoint: typeof raw.api === "string" ? endpointKey(raw.api) : undefined,
      models: new Map(),
    };
    for (const [id, model] of Object.entries(raw.models)) {
      if (!record(model)) continue;
      const canonical =
        typeof model.canonical_model_id === "string" &&
        model.canonical_model_id.includes("/")
          ? model.canonical_model_id
          : undefined;
      const entry: Entry = {
        id,
        context: record(model.limit)
          ? positive(model.limit.context)
          : undefined,
        canonical,
      };
      service.models.set(id, entry);
      const name = normalizeModel(id);
      if (name)
        catalog.byName.set(name, [
          ...(catalog.byName.get(name) ?? []),
          { service: serviceId, entry },
        ]);
      if (canonical) catalog.makers.add(canonical.split("/")[0]);
    }
    catalog.services.push(service);
    catalog.byId.set(serviceId, service);
  }
  return catalog;
}

/** Exact id, then ignoring case, then the normalized id. */
function find(models: Map<string, Entry>, id: string) {
  const exact = models.get(id);
  if (exact) return exact;
  const lower = id.toLowerCase();
  const name = normalizeModel(id);
  let normalized: Entry | undefined;
  for (const [key, entry] of models) {
    if (key.toLowerCase() === lower) return entry;
    normalized ??= normalizeModel(key) === name ? entry : undefined;
  }
  return normalized;
}

/**
 * The maker's entry: the one other services' entries point at, or else the
 * maker's own entry of that name. Unclear when more than one maker matches.
 */
function maker(catalog: Catalog, id: string) {
  const pointed = new Map<string, Entry>();
  const owned = new Map<string, Entry>();
  for (const { service, entry } of catalog.byName.get(normalizeModel(id)) ??
    []) {
    if (entry.canonical) {
      const [makerId] = entry.canonical.split("/");
      const target = catalog.byId
        .get(makerId)
        ?.models.get(entry.canonical.slice(makerId.length + 1));
      if (target) {
        pointed.set(entry.canonical, target);
        continue;
      }
    }
    if (catalog.makers.has(service)) owned.set(`${service}/${entry.id}`, entry);
  }
  const found = pointed.size > 0 ? pointed : owned;
  return found.size === 1 ? [...found.values()][0] : undefined;
}

/**
 * The model's context window: the entry of the service at `base` when it
 * gives one, else the maker's entry (GPT capped at {@link GPT_WINDOW_CAP}).
 */
export function contextWindow(
  catalog: Catalog,
  base: string,
  model: string,
): number | undefined {
  const id = model.trim();
  const key = endpointKey(base);
  if (!id || !key) return undefined;
  const own = catalog.services
    .filter((service) => service.endpoint === key)
    .map((service) => find(service.models, id))
    .find((entry) => entry);
  if (own?.context) return own.context;
  const context = maker(catalog, id)?.context;
  return context && isGpt(id) ? Math.min(context, GPT_WINDOW_CAP) : context;
}
