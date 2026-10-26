// OpenCode Go chat@1 provider for Plums, using Go's OpenAI-compatible
// Chat Completions endpoint.
//
// The API key never reaches this file: manifest.json declares one credential
// binding for the endpoint, the user enters the key in the extension's
// details ("连接与凭据"), and the native layer adds the Authorization header.
//
// Only models that OpenCode's docs (https://opencode.ai/docs/go) list on the
// chat/completions endpoint are offered; models served only through the
// Anthropic Messages, OpenAI Responses or Google endpoints are left out.
//
// Only declarations live at top level; all work starts in activate().

/** Binding alias in manifest.json. */
const BINDING = "chat";

/** Models offered to Agents; ids are sent to Go unchanged. */
const MODELS = [
  { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", note: "需在 OpenCode 控制台的隐私设置中启用 Global 区域。" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", note: "需在 OpenCode 控制台的隐私设置中启用 Global 区域。" },
  { id: "glm-5.3", label: "GLM-5.3" },
  { id: "kimi-k3.1-pro", label: "Kimi K3.1 Pro" },
  { id: "kimi-k3", label: "Kimi K3" },
  { id: "minimax-m3.1-flash", label: "MiniMax M3.1 Flash" },
];

/** Output cap per reply; GLM and Kimi think first, so this leaves room for both. */
const MAX_TOKENS = 1024;

/** Upper bound for an upstream error message quoted to the user. */
const MAX_ERROR_TEXT = 200;

/** Error with the `outcome` field chat@1 failures are expected to carry. */
function failure(message, outcome, code) {
  const error = new Error(message);
  error.outcome = outcome;
  if (code) error.code = code;
  return error;
}

/**
 * Builds the Chat Completions body. Instructions become the first system
 * message; Plums roles map user -> "user" and agent -> "assistant". Empty
 * turns are skipped, leading assistant turns dropped and consecutive turns of
 * the same role merged, so the conversation alternates and starts with the user.
 */
function buildBody({ model, instructions, history, input }) {
  const turns = [];
  for (const turn of [...history, { role: "user", text: input }]) {
    const role = turn.role === "agent" ? "assistant" : "user";
    const text = typeof turn.text === "string" ? turn.text : "";
    if (!text.trim()) continue;
    if (turns.length === 0 && role === "assistant") continue;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += `\n\n${text}`;
    else turns.push({ role, content: text });
  }
  if (turns.length === 0 || turns[turns.length - 1].role !== "user") {
    throw failure("没有可发送的消息。", "not-dispatched", "empty-input");
  }
  const messages = [];
  if (instructions && instructions.trim()) {
    messages.push({ role: "system", content: instructions });
  }
  messages.push(...turns);
  return { model, messages, max_tokens: MAX_TOKENS, stream: false };
}

/** Drops anything that looks like a bearer token or API key before quoting upstream text. */
function redact(text) {
  return String(text)
    .replace(/\b(sk|key|ocg?)[-_][0-9A-Za-z_-]{12,}/gi, "[已隐去]")
    .replace(/[0-9A-Za-z_-]{32,}/g, "[已隐去]")
    .slice(0, MAX_ERROR_TEXT);
}

/** User-facing error for a non-200 HTTP response. The request reached OpenCode. */
function httpFailure(status, rawBody) {
  let detail = "";
  try {
    const parsed = JSON.parse(rawBody);
    const error = parsed?.error;
    const message = typeof error === "string" ? error : error?.message;
    if (typeof message === "string") detail = redact(message);
  } catch {
    // Not JSON (e.g. an HTML error page); report the status only.
  }
  let hint;
  if (status === 401) hint = "API Key 无效，请在扩展详情中重新填写。";
  else if (status === 403) hint = "没有权限：请检查 OpenCode Go 订阅、区域与隐私设置是否允许这个模型。";
  else if (status === 402) hint = "OpenCode Go 额度已用完。";
  else if (status === 404) hint = "找不到这个模型，可能已下线。";
  else if (status === 429) hint = "请求过于频繁或已到用量上限，请稍后再试。";
  else if (status >= 500) hint = "OpenCode Go 服务暂时不可用，请稍后再试。";
  else hint = "OpenCode Go 拒绝了这次请求。";
  const tail = [`HTTP ${status}`, detail].filter(Boolean).join("，");
  // The request reached OpenCode, so whatever the status, it was dispatched.
  return failure(`${hint}（${tail}）`, "unknown", `http-${status}`);
}

/** Reads one Chat Completions response and returns the answer text. */
function readResponse(rawBody) {
  let data;
  try {
    data = JSON.parse(rawBody);
  } catch {
    throw failure("OpenCode Go 的回复不是有效的 JSON。", "unknown", "bad-response");
  }
  const choice = Array.isArray(data?.choices) ? data.choices[0] : undefined;
  if (!choice) throw failure("OpenCode Go 没有给出回复。", "unknown", "no-choice");
  const message = choice.message ?? {};
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    throw failure("模型试图调用工具，本扩展不支持。", "unknown", "tool-call");
  }
  // Some models return `content` as an array of text parts.
  const content = Array.isArray(message.content)
    ? message.content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("")
    : typeof message.content === "string"
      ? message.content
      : "";
  // Reasoning (`reasoning_content`) is the model's thinking, not the answer; it is ignored.
  const reason = choice.finish_reason;
  if (reason === "length") {
    if (!content) throw failure("回复超出了长度上限。", "unknown", "length");
    return `${content}\n\n（回复因长度上限被截断）`;
  }
  if (reason === "content_filter") {
    throw failure("回复被服务的内容过滤拦截。", "unknown", "content-filter");
  }
  if (!content.trim()) throw failure("OpenCode Go 返回了空回复。", "unknown", "empty-reply");
  return content;
}

/** Validates the platform's `{ status, body }` result before using it. */
function checkResponse(result) {
  if (!result || typeof result.status !== "number" || typeof result.body !== "string") {
    throw failure("应用返回了无法识别的结果。", "unknown", "bad-platform-response");
  }
  return result;
}

/** @type {import('../../modules/sdk').ExtensionMain} */
export default {
  activate(ctx) {
    // The platform allows one credential request per extension at a time
    // ("busy" otherwise), so replies for different Agents wait their turn here.
    // Cancelling while waiting leaves the queue at once.
    let queue = Promise.resolve();
    async function exclusive(run, signal) {
      const previous = queue;
      let release;
      queue = previous.then(() => new Promise((resolve) => (release = resolve)));
      try {
        await new Promise((resolve, reject) => {
          const onAbort = () => reject(signal.reason);
          signal.addEventListener("abort", onAbort, { once: true });
          previous.then(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          });
        });
        signal.throwIfAborted();
        return await run();
      } finally {
        // `release` is set once `previous` settles; settle our slot either way.
        previous.then(() => release());
      }
    }

    /** @type {import('../../extensions/contracts').ChatService} */
    const service = {
      name: "OpenCode Go",
      models: () =>
        MODELS.map(({ id, label, note }) => ({
          id,
          label,
          description: `OpenCode Go 订阅中的 ${label}（OpenAI 兼容接口）。${note ?? ""}`,
          group: "OpenCode Go",
        })),
      subscribe: () => () => {},
      async reply(request, signal) {
        signal.throwIfAborted();
        if (!MODELS.some((entry) => entry.id === request.model)) {
          throw failure(`没有这个模型：${request.model}`, "not-dispatched", "unknown-model");
        }
        const body = JSON.stringify(buildBody(request));
        return exclusive(async () => {
          const result = checkResponse(
            await ctx.platform("credential.request", { version: 1, binding: BINDING, body }, signal),
          );
          if (result.status !== 200) throw httpFailure(result.status, result.body);
          return readResponse(result.body);
        }, signal);
      },
    };
    ctx.provide("chat", 1, service);
  },
};
