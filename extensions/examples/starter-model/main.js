// Plums 扩展起步模板：一个本地“模型”。
//
// 扩展包是一个文件夹（或它的 zip）：manifest.json 写名称、ID 与所需能力，
// main.js（本文件）默认导出 { activate }。导入时只读取 manifest.json，
// 确认后才执行本文件，所以不要在文件顶层做事情，真正的工作放进 activate()。
//
// 导入后在扩展管理中启用本扩展，再在 Agent 的输入框下方选择「起步模型」，
// 这个 Agent 的回复就由下面的 reply() 生成。把 reply() 换成调用真实服务，
// 就是一个模型连接；联网与密钥见 docs/CREDENTIAL-REQUEST.md。
// 改完代码后重新导入即可替换。启用状态会自动保留，重启后仍然启用。

// 下面的 @type 注释只给编辑器提供类型提示，运行时会被忽略；在仓库外使用可以删掉。
/** @type {Pick<import('../../../modules/sdk').ExtensionMain, "activate">} */
export default {
  activate(ctx) {
    /** @type {import('../../contracts').ChatService} */
    const service = {
      name: "起步模型",
      // 用户在 Agent 里能选的模型；id 会传给 reply()。
      models: () => [
        {
          id: "count",
          label: "起步模型",
          description: "本地模板：统计字数并原样回显，不联网。",
        },
      ],
      // 模型列表不会变化，所以不需要通知。
      subscribe: () => () => {},
      // history 是此前的对话，instructions 是 Agent 的介绍。
      async reply({ input }, signal) {
        // 用户点「停止」或扩展被停用时 signal 会中止；耗时工作中要随时检查。
        signal.throwIfAborted();
        const count = [...input.trim()].length;
        return `你写了 ${count} 个字：${input}`;
      },
    };
    ctx.provide("chat", 1, service);
  },
};
