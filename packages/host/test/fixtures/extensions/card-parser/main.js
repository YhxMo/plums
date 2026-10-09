// Original test implementation based on the public CC V1/V2/V3 specifications.
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value) =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const fail = () => {
  throw Error("CARD_UNRECOGNIZED");
};
function extensions(value) {
  if (value === undefined) return {};
  if (!object(value)) fail();
  return value;
}
function optional(value, type, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== type || (type === "number" && !Number.isFinite(value)))
    fail();
  return value;
}
function book(value) {
  if (!object(value) || !Array.isArray(value.entries)) fail();
  const entries = value.entries.map((entry) => {
    if (
      !object(entry) ||
      !strings(entry.keys) ||
      typeof entry.content !== "string" ||
      typeof entry.enabled !== "boolean" ||
      typeof entry.insertion_order !== "number" ||
      !Number.isFinite(entry.insertion_order)
    )
      fail();
    let secondaryKeys = entry.secondary_keys ?? [];
    // The V3 prose also permits comma-separated secondary keys.
    if (typeof secondaryKeys === "string")
      secondaryKeys = secondaryKeys
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean);
    if (
      !strings(secondaryKeys) ||
      (entry.position !== undefined &&
        !["before_char", "after_char"].includes(entry.position))
    )
      fail();
    const result = {
      keys: entry.keys,
      secondaryKeys,
      content: entry.content,
      enabled: entry.enabled,
      insertionOrder: entry.insertion_order,
      caseSensitive: optional(entry.case_sensitive, "boolean", false),
      constant: optional(entry.constant, "boolean", false),
      selective: optional(entry.selective, "boolean", false),
      position: entry.position ?? "before_char",
      extensions: extensions(entry.extensions),
    };
    if (entry.use_regex !== undefined)
      result.useRegex = optional(entry.use_regex, "boolean");
    return result;
  });
  const result = { entries, extensions: extensions(value.extensions) };
  if (value.name !== undefined) result.name = optional(value.name, "string");
  if (value.scan_depth !== undefined) {
    result.scanDepth = optional(value.scan_depth, "number");
    if (!Number.isInteger(result.scanDepth) || result.scanDepth < 0) fail();
  }
  if (value.token_budget !== undefined)
    result.tokenBudget = optional(value.token_budget, "number");
  if (value.recursive_scanning !== undefined)
    result.recursiveScanning = optional(value.recursive_scanning, "boolean");
  return result;
}
function parse(value) {
  try {
    if (!object(value)) fail();
    let source, data;
    if (value.spec === undefined) {
      source = "v1";
      data = value;
    } else if (value.spec === "chara_card_v2" && value.spec_version === "2.0") {
      source = "v2";
      data = value.data;
    } else if (
      value.spec === "chara_card_v3" &&
      typeof value.spec_version === "string" &&
      /^3\.\d+$/.test(value.spec_version)
    ) {
      source = "v3";
      data = value.data;
    } else fail();
    if (!object(data)) fail();
    for (const key of [
      "name",
      "description",
      "personality",
      "scenario",
      "first_mes",
      "mes_example",
    ])
      if (typeof data[key] !== "string") fail();
    if (source !== "v1") {
      for (const key of [
        "creator_notes",
        "system_prompt",
        "post_history_instructions",
        "creator",
        "character_version",
      ])
        if (typeof data[key] !== "string") fail();
      if (!strings(data.alternate_greetings) || !strings(data.tags)) fail();
      if (source === "v3" && !strings(data.group_only_greetings)) fail();
    }
    const result = {
      source,
      name: data.name,
      description: data.description,
      personality: data.personality,
      scenario: data.scenario,
      firstMessage: data.first_mes,
      exampleMessages: data.mes_example,
      systemPrompt: source === "v1" ? "" : data.system_prompt,
      postHistoryInstructions:
        source === "v1" ? "" : data.post_history_instructions,
      alternateGreetings: source === "v1" ? [] : data.alternate_greetings,
      tags: source === "v1" ? [] : data.tags,
      creator: source === "v1" ? "" : data.creator,
      characterVersion: source === "v1" ? "" : data.character_version,
      creatorNotes: source === "v1" ? "" : data.creator_notes,
      extensions: extensions(data.extensions),
    };
    if (data.character_book !== undefined)
      result.characterBook = book(data.character_book);
    return result;
  } catch {
    return { error: { code: "CARD_UNRECOGNIZED" } };
  }
}
export function activate(sdk) {
  sdk.register("tools", "card", async ({ operation, input }) =>
    operation === "list"
      ? sdk.characters()
      : parse(await sdk.character(input.characterId)),
  );
}
