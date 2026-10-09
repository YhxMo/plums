// Synthetic wire protocol, implemented entirely outside the host.
export function activate(sdk) {
  sdk.register("connectors", "model", async ({ input }) => {
    const connection = await sdk.connection("model");
    const response = await sdk.capability("api", {
      kind: "service",
      operation: "request",
      binding: connection.binding,
      sources: [],
      input: {
        path: "/complete",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    });
    if (response.result.status < 200 || response.result.status >= 300)
      await sdk.failResponse(response.callId, "HTTP_REJECTED");
    let result;
    try {
      result = JSON.parse(response.result.body);
    } catch {
      await sdk.failResponse(response.callId, "RESPONSE_INVALID");
    }
    // The contribution output schema validates the decoded business reply.
    return result;
  });
}
