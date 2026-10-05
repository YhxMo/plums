export function activate(sdk) {
  sdk.register("connectors", "complete", async (input) => {
    const settings = await sdk.settings();
    if (!settings.model)
      throw Error("Configure the model in connector settings");
    const reply = await sdk.capability("model-api", {
      kind: "egress",
      url: settings.endpoint || "https://api.openai.com/v1/chat/completions",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.model,
        messages: input.messages,
        tools: input.tools,
        store: false,
      }),
    });
    if (
      reply.result.status < 200 ||
      reply.result.status >= 300 ||
      reply.result.redirectTo
    )
      throw Error("Model request failed");
    return JSON.parse(reply.result.body);
  });
}
