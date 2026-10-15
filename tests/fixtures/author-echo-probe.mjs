/**
 * @typedef {object} EchoProbe
 * @property {(body: string, binding?: 'text' | 'slow', signal?: AbortSignal) => Promise<string>} request
 */

/**
 * Creates a connector using only the public SDK lifecycle and platform contracts.
 * @param {string} [id]
 * @returns {import('../../modules/sdk').ExtensionDefinition}
 */
export function createEchoProbe(id = "probe.alpha") {
  const service = `${id}.echo`;
  return {
    manifest: {
      id,
      version: "1.0.0",
      apiVersion: 1,
      capabilities: ["credential.request"],
      provides: { [service]: 1 },
    },
    activate(ctx) {
      /** @type {EchoProbe} */
      const echo = {
        async request(body, binding = "text", signal) {
          return ctx.task(async (taskSignal) => {
            /** @type {import('../../modules/sdk').CredentialRequest} */
            const request = { version: 1, binding, body };
            // Host combines the operation signal with the extension lifecycle.
            const response = await ctx.platform(
              "credential.request",
              request,
              signal ?? taskSignal,
            );
            if (
              !response ||
              typeof response !== "object" ||
              !("status" in response) ||
              response.status !== 200 ||
              !("body" in response) ||
              typeof response.body !== "string" ||
              new TextEncoder().encode(response.body).byteLength > 8192
            ) {
              throw Error("Echo response rejected");
            }
            return response.body;
          });
        },
      };
      ctx.provide(service, 1, echo);
    },
  };
}

export default createEchoProbe();
