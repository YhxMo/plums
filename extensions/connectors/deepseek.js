/**
 * Single-turn, non-streaming model protocol. Networking and secrets remain
 * behind the calling extension's credential binding.
 * @type {import('../../modules/sdk').ExtensionDefinition}
 */
export default {
  manifest: {
    id: "connector.deepseek",
    version: "0.1.0",
    apiVersion: 1,
    capabilities: ["credential.request"],
    provides: { "text.transform": 1 },
    credentialBindings: {
      text: {
        label: "DeepSeek 官方 API",
        target: "https://api.deepseek.com/chat/completions",
        contentType: "application/json",
        headers: {},
        authentication: { type: "bearer" },
      },
    },
    configuration: {
      version: 1,
      fields: {
        model: {
          type: "string",
          label: "模型",
          default: "deepseek-flash",
          maxLength: 80,
        },
        maxTokens: {
          type: "number",
          label: "最大输出 token 数",
          default: 256,
          min: 1,
          max: 512,
        },
      },
    },
  },
  activate(ctx) {
    const { model, maxTokens } = ctx.configuration;
    if (
      typeof model !== "string" ||
      !model.trim() ||
      model !== model.trim() ||
      typeof maxTokens !== "number" ||
      !Number.isSafeInteger(maxTokens)
    )
      throw Error("DeepSeek 模型或输出预算配置无效。");
    /** @type {import('../contracts').Transformer} */
    const service = {
      name: `DeepSeek · ${model}`,
      async transform(input, signal) {
        signal.throwIfAborted();
        if (typeof input !== "string" || !input.trim())
          throw failure("请输入需要发送给 DeepSeek 的文本。", "not-dispatched");
        const body = JSON.stringify({
          model,
          messages: [{ role: "user", content: input }],
          max_tokens: maxTokens,
          thinking: { type: "disabled" },
          stream: false,
        });
        if (new TextEncoder().encode(body).length > 4096)
          throw failure(
            "DeepSeek 请求连同 JSON 封装不能超过 4096 字节，请缩短输入。",
            "not-dispatched",
          );
        return ctx.task(async (lifecycleSignal) => {
          const combined = AbortSignal.any([signal, lifecycleSignal]);
          combined.throwIfAborted();
          let response;
          try {
            response = await ctx.platform(
              "credential.request",
              { version: 1, binding: "text", body },
              combined,
            );
          } catch (error) {
            const outcome =
              object(error) &&
              (error.outcome === "not-dispatched" ||
                error.outcome === "not-committed")
                ? error.outcome
                : "unknown";
            throw failure(
              outcome === "unknown"
                ? "DeepSeek 请求结果未确认；请先核对，重试可能产生重复调用或计费。"
                : "DeepSeek 请求未发送，请检查绑定和授权。",
              outcome,
            );
          }
          if (combined.aborted)
            throw failure(
              "DeepSeek 请求已取消；远端结果未确认，重试可能产生重复调用或计费。",
              "unknown",
            );
          if (
            !object(response) ||
            typeof response.status !== "number" ||
            !Number.isInteger(response.status) ||
            response.status < 200 ||
            response.status > 599 ||
            typeof response.body !== "string"
          )
            throw Error("DeepSeek 响应格式无效，本次未保存回复。");
          if (response.status !== 200)
            throw Error(
              `DeepSeek 请求失败（HTTP ${response.status}），请检查服务状态和配置。`,
            );
          /** @type {unknown} */
          let parsed;
          try {
            parsed = JSON.parse(response.body);
          } catch {
            throw Error("DeepSeek 响应不是有效 JSON，本次未保存回复。");
          }
          const choice =
            object(parsed) &&
            Array.isArray(parsed.choices) &&
            parsed.choices.length === 1
              ? parsed.choices[0]
              : null;
          if (
            !object(choice) ||
            choice.index !== 0 ||
            choice.finish_reason !== "stop" ||
            !object(choice.message) ||
            choice.message.role !== "assistant" ||
            typeof choice.message.content !== "string" ||
            !choice.message.content.trim() ||
            (choice.message.tool_calls != null &&
              (!Array.isArray(choice.message.tool_calls) ||
                choice.message.tool_calls.length !== 0))
          )
            throw Error("DeepSeek 未返回完整文本，本次未保存回复。");
          return choice.message.content;
        });
      },
    };
    ctx.provide("text.transform", 1, service);
  },
};

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function object(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
/**
 * @param {string} message
 * @param {import('../../modules/sdk').CredentialFailureOutcome | 'not-committed'} outcome
 */
function failure(message, outcome) {
  return Object.assign(new Error(message), { outcome });
}
