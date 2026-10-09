import { HttpMcpTransport } from "./http.js";
import { McpClient } from "./client.js";

export function activate(sdk) {
  let client,
    binding,
    pending = Promise.resolve();
  sdk.register("connectors", "tools", ({ operation, input }) => {
    const next = pending.then(async () => {
      const connection = await sdk.connection("mcp");
      if (!client || binding !== connection.binding) {
        binding = connection.binding;
        client = new McpClient(new HttpMcpTransport(sdk, binding), sdk);
      }
      return operation === "list" ? client.list() : client.call(input);
    });
    pending = next.catch(() => {});
    return next;
  });
}
