// Independent table-driven test parser. No platform or third-party business code.
const isObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const isStrings = (v) =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const invalid = () => {
  throw Error("CARD_UNRECOGNIZED");
};
const fields = {
  name: "name",
  description: "description",
  personality: "personality",
  scenario: "scenario",
  firstMessage: "first_mes",
  exampleMessages: "mes_example",
  systemPrompt: "system_prompt",
  postHistoryInstructions: "post_history_instructions",
  creator: "creator",
  characterVersion: "character_version",
  creatorNotes: "creator_notes",
};
function extra(v) {
  if (v === undefined) return {};
  if (!isObject(v)) invalid();
  return v;
}
function convert(raw) {
  if (!isObject(raw)) invalid();
  const source =
    raw.spec === undefined
      ? "v1"
      : new Map([
          ["chara_card_v2", "v2"],
          ["chara_card_v3", "v3"],
        ]).get(raw.spec);
  if (
    !source ||
    (source === "v2" && raw.spec_version !== "2.0") ||
    (source === "v3" &&
      (typeof raw.spec_version !== "string" ||
        !/^3\.\d+$/.test(raw.spec_version)))
  )
    invalid();
  const data = source === "v1" ? raw : raw.data;
  if (!isObject(data)) invalid();
  const result = { source };
  for (const [output, input] of Object.entries(fields)) {
    const old = [
      "name",
      "description",
      "personality",
      "scenario",
      "first_mes",
      "mes_example",
    ].includes(input);
    const value = source === "v1" && !old ? "" : data[input];
    if (typeof value !== "string") invalid();
    result[output] = value;
  }
  for (const [output, input] of [
    ["alternateGreetings", "alternate_greetings"],
    ["tags", "tags"],
  ]) {
    const value = source === "v1" ? [] : data[input];
    if (!isStrings(value)) invalid();
    result[output] = value;
  }
  if (source === "v3" && !isStrings(data.group_only_greetings)) invalid();
  result.extensions = extra(data.extensions);
  if (data.character_book !== undefined) {
    const rawBook = data.character_book;
    if (!isObject(rawBook) || !Array.isArray(rawBook.entries)) invalid();
    const converted = { entries: [], extensions: extra(rawBook.extensions) };
    if (rawBook.name !== undefined) {
      if (typeof rawBook.name !== "string") invalid();
      converted.name = rawBook.name;
    }
    if (rawBook.scan_depth !== undefined) {
      if (!Number.isInteger(rawBook.scan_depth) || rawBook.scan_depth < 0)
        invalid();
      converted.scanDepth = rawBook.scan_depth;
    }
    for (const [output, input, type] of [
      ["tokenBudget", "token_budget", "number"],
      ["recursiveScanning", "recursive_scanning", "boolean"],
    ]) {
      if (rawBook[input] === undefined) continue;
      if (
        typeof rawBook[input] !== type ||
        (type === "number" && !Number.isFinite(rawBook[input]))
      )
        invalid();
      converted[output] = rawBook[input];
    }
    for (const item of rawBook.entries) {
      if (
        !isObject(item) ||
        !isStrings(item.keys) ||
        typeof item.content !== "string" ||
        typeof item.enabled !== "boolean" ||
        !Number.isFinite(item.insertion_order)
      )
        invalid();
      const secondaryKeys =
        typeof item.secondary_keys === "string"
          ? item.secondary_keys
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean)
          : (item.secondary_keys ?? []);
      if (!isStrings(secondaryKeys)) invalid();
      const entry = {
        keys: item.keys,
        secondaryKeys,
        content: item.content,
        enabled: item.enabled,
        insertionOrder: item.insertion_order,
        extensions: extra(item.extensions),
      };
      for (const [output, input] of [
        ["constant", "constant"],
        ["selective", "selective"],
        ["caseSensitive", "case_sensitive"],
      ]) {
        if (item[input] !== undefined && typeof item[input] !== "boolean")
          invalid();
        entry[output] = item[input] ?? false;
      }
      entry.position = item.position ?? "before_char";
      if (item.use_regex !== undefined) {
        if (typeof item.use_regex !== "boolean") invalid();
        entry.useRegex = item.use_regex;
      }
      if (!["before_char", "after_char"].includes(entry.position)) invalid();
      converted.entries.push(entry);
    }
    result.characterBook = converted;
  }
  return result;
}
export function activate(sdk) {
  sdk.register("tools", "card", async (request) => {
    if (request.operation === "list") return sdk.characters();
    const raw = await sdk.character(request.input.characterId);
    try {
      return convert(raw);
    } catch {
      return { error: { code: "CARD_UNRECOGNIZED" } };
    }
  });
}
