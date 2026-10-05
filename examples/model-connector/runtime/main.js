import { modelProtocol, modelPath } from "./endpoint.js";
import { modelRequest, modelResponse, setCallIdentity } from "./protocols.js";
export function activate(sdk) {
  sdk.register("connectors", "complete", async (input) => {
    const settings = await sdk.settings(),
      connection = await sdk.connection("api"),
      context = await sdk.context();
    setCallIdentity(context.invocationId);
    const protocol = modelProtocol(settings.protocol),
      model = settings.model?.trim();
    if (!model || !connection.ready)
      throw Error("Configure the model connection");
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": "Plums",
    };
    if (protocol === "Anthropic Messages")
      headers["anthropic-version"] = "2023-06-01";
    if (connection.origin === "https://opencode.ai")
      headers["x-opencode-session"] = context.agentId;
    const reply = await sdk.capability("model-api", {
      kind: "service",
      operation: "request",
      binding: connection.binding,
      sources: [],
      input: {
        path: modelPath(connection.basePath, protocol, model),
        method: "POST",
        headers,
        body: JSON.stringify(
          modelRequest(
            protocol,
            model,
            {
              messages: input.messages,
              ...(input.tools ? { tools: input.tools } : {}),
            },
            connection.fingerprint,
          ),
        ),
      },
    });
    if (reply.result.status < 200 || reply.result.status >= 300)
      return sdk.failResponse(reply.callId, "HTTP_REJECTED");
    try {
      return modelResponse(
        protocol,
        JSON.parse(reply.result.body),
        connection.fingerprint,
        !!input.tools?.length,
      );
    } catch {
      return sdk.failResponse(reply.callId, "RESPONSE_INVALID");
    }
  });
}
