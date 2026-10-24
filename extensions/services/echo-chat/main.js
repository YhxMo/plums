/**
 * Development `chat@1` provider: answers locally with what it was sent, so
 * per-Agent models and conversation history can be checked without a key.
 * @type {import('../../../modules/sdk').ExtensionMain}
 */
export default {
  activate(ctx) {
    /** @type {import('../../contracts').ChatService} */
    const service = {
      name: "回显模型",
      models: () =>
        ["echo-a", "echo-b"].map((id) => ({
          id,
          label: `回显 ${id.slice(-1).toUpperCase()}`,
          description: "本地回显：显示收到的轮数与角色说明，不发送到网络。",
          // Only B takes a strength and reads pictures, so both cases can be checked.
          ...(id === "echo-b" && {
            reasoning: ["off", "low", "high"],
            vision: true,
          }),
        })),
      subscribe: () => () => {},
      async reply(
        { model, instructions, history, input, images, effort },
        signal,
      ) {
        signal.throwIfAborted();
        const turns = history.filter((turn) => turn.role === "user").length;
        const first = history.find((turn) => turn.role === "user")?.text;
        return `${model}｜第 ${turns + 1} 轮｜说明：${instructions ?? "无"}｜最早：${first ?? "无"}｜${input}${effort ? `｜强度：${effort}` : ""}${images?.length ? `｜图片：${images.length}` : ""}`;
      },
    };
    ctx.provide("chat", 1, service);
  },
};
