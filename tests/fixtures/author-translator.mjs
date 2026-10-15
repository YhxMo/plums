/**
 * A synthetic translation connector. Protocol parsing belongs to this extension.
 * @param {string} id
 * @returns {import('../../modules/sdk').ExtensionDefinition}
 */
export function createTranslator(id) {
  const serviceName = `${id}.translator`;
  return {
    manifest: {
      id,
      version: "1.0.0",
      apiVersion: 1,
      capabilities: ["credential.request"],
      provides: { [serviceName]: 1 },
    },
    activate(ctx) {
      ctx.provide(serviceName, 1, {
        /** @param {string} text */
        async translate(text) {
          /** @type {import('../../modules/sdk').CredentialRequest} */
          const request = {
            version: 1,
            binding: "translate",
            body: JSON.stringify({ text }),
          };
          const response = await ctx.platform("credential.request", request);
          if (
            !response ||
            typeof response !== "object" ||
            !("status" in response) ||
            typeof response.status !== "number" ||
            response.status < 200 ||
            response.status >= 300 ||
            !("body" in response) ||
            typeof response.body !== "string"
          ) {
            throw Error("Translation response rejected");
          }
          /** @type {unknown} */
          const parsed = JSON.parse(response.body);
          if (
            !parsed ||
            typeof parsed !== "object" ||
            !("translated" in parsed) ||
            typeof parsed.translated !== "string"
          ) {
            throw Error("Translation response rejected");
          }
          return parsed.translated;
        },
      });
    },
  };
}

export default createTranslator("author.translator");
