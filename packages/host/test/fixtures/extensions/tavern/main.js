// Intentionally limited world-book behavior for synthetic scenario tests.
export function activate(sdk) {
  sdk.register("tools", "context", async ({ input }) => {
    const card = await sdk.protocols.invoke("card", {
      operation: "parse",
      input: {},
    });
    if (card.error) return card;
    const book = card.characterBook;
    if (!book) return { system: [], injections: [], unsupported: [] };
    const unsupported = new Set();
    const inspect = (extensions) => {
      if (extensions.use_regex) unsupported.add("regex");
      if (extensions.recursive_scanning) unsupported.add("recursive-scanning");
      if (extensions.decorators) unsupported.add("decorators");
      if (extensions.token_budget !== undefined)
        unsupported.add("token-budget");
    };
    inspect(book.extensions);
    if (book.tokenBudget !== undefined) unsupported.add("token-budget");
    if (book.recursiveScanning !== undefined)
      unsupported.add("recursive-scanning");
    const depth = book.scanDepth ?? 4;
    const messages = depth === 0 ? [] : input.messages.slice(-depth);
    const entries = book.entries.filter((entry) => {
      inspect(entry.extensions);
      if (entry.useRegex) unsupported.add("regex");
      if (/^@@[^\r\n]*/m.test(entry.content)) unsupported.add("decorators");
      if (!entry.enabled) return false;
      if (entry.constant) return true;
      const content = messages.map((message) =>
        entry.caseSensitive ? message.content : message.content.toLowerCase(),
      );
      const hit = (keys) =>
        keys.some((key) =>
          content.some((text) =>
            text.includes(entry.caseSensitive ? key : key.toLowerCase()),
          ),
        );
      return hit(entry.keys) && (!entry.selective || hit(entry.secondaryKeys));
    });
    entries.sort((a, b) => a.insertionOrder - b.insertionOrder);
    return {
      system: [],
      injections: entries.map((entry) => ({
        position: entry.position,
        content: entry.content.replace(/^@@[^\r\n]*(?:\r?\n|$)/gm, ""),
      })),
      unsupported: [...unsupported].sort(),
    };
  });
}
