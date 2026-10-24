/** @type {import('../../../modules/sdk').ExtensionMain} */
export default {
  activate(ctx) {
    /** @type {import('../../contracts').Transformer} */
    const service = {
      name: "Reverse",
      description: "本地示例：把输入逆序，不连接语言模型。",
      async transform(input, signal) {
        signal.throwIfAborted();
        return [...input].reverse().join("");
      },
    };
    ctx.provide("text.transform", 1, service);
  },
};
