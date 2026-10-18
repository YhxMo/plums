// Plums 扩展起步模板：一个文本服务。
//
// 导入后停用当前的文本服务（如「大写转换服务」或 DeepSeek），再启用本扩展，
// 默认 Agent 的回复就由下面的 transform() 生成。改完代码后重新导入同一文件即可替换。
// 想让它在重启后仍然启用，在扩展管理中点「保存当前组合」。
//
// 整个扩展是一个文件，默认导出 { manifest, activate }。不要在文件顶层做事情：
// 导入时文件就会执行，真正的工作放进 activate()。

// 下面的 @type 注释只给编辑器提供类型提示，运行时会被忽略；在仓库外使用可以删掉。
/** @type {import('../../modules/sdk').ExtensionDefinition} */
export default {
  manifest: {
    // 小写字母开头，只含小写字母、数字、点和连字符。改成你自己的 ID。
    id: "starter.text-service",
    version: "0.1.0",
    apiVersion: 1,
    // 提供 Agent 使用的文本服务（版本 1）。同一时间只能有一个扩展提供它。
    provides: { "text.transform": 1 },
  },
  activate(ctx) {
    /** @type {import('../contracts').Transformer} */
    const service = {
      // 显示给用户：回复由谁生成、文字发往哪里。
      name: "起步模板",
      description: "本地模板：统计字数并原样回显，不联网。",
      async transform(input, signal) {
        // 用户点「停止」或扩展被停用时 signal 会中止；耗时工作中要随时检查。
        signal.throwIfAborted();
        const count = [...input.trim()].length;
        return `你写了 ${count} 个字：${input}`;
      },
    };
    ctx.provide("text.transform", 1, service);
  },
};
