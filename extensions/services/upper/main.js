/** @type {import('../../../modules/sdk').ExtensionMain} */
export default {
  activate(ctx) {
    /** @type {import('../../contracts').Transformer} */
    const service = {
      name: "Uppercase",
      description: "本地示例：把输入转为大写，不连接语言模型。",
      async transform(input, signal) {
        signal.throwIfAborted();
        await new Promise((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(new DOMException("Cancelled", "AbortError"));
          };
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve(undefined);
          }, 650);
          signal.addEventListener("abort", abort, { once: true });
        });
        signal.throwIfAborted();
        return input.toLocaleUpperCase();
      },
    };
    ctx.provide("text.transform", 1, service);
  },
};
