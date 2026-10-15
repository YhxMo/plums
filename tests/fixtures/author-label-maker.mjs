/** @type {import('../../modules/sdk').ExtensionDefinition} */
export default {
  manifest: {
    id: "author.label-maker",
    version: "1.0.0",
    apiVersion: 1,
    configuration: {
      version: 1,
      fields: {
        prefix: {
          type: "string",
          label: "标签前缀",
          default: "#",
          maxLength: 12,
        },
        limit: {
          type: "number",
          label: "正文长度",
          default: 8,
          min: 1,
          max: 40,
        },
        uppercase: { type: "boolean", label: "正文大写", default: false },
      },
    },
  },
  activate(ctx) {
    const { prefix, limit, uppercase } = ctx.configuration;
    ctx.on(`${ctx.id}.request`, (data) => {
      if (typeof data !== "string") return;
      const body = (uppercase ? data.toUpperCase() : data).slice(
        0,
        Number(limit),
      );
      ctx.emit(`${ctx.id}.response`, `${prefix}${body}`);
    });
  },
};
