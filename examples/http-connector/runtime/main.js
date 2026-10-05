export function activate(sdk) {
  sdk.register("connectors", "inspect", async () => {
    const response = await sdk.capability("example-api", {
      kind: "egress",
      url: "https://example.com",
      method: "GET",
      headers: { Accept: "text/html" },
    });
    return {
      status: response.result.status,
      contentType: response.result.headers?.["content-type"],
      characters: response.result.body.length,
    };
  });
}
