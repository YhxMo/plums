import type { CredentialFailureOutcome } from "../sdk";

export type Protocol = "openai-chat" | "anthropic-messages";
export type Turn = { role: "user" | "agent"; text: string };
export type ChatInput = {
  instructions?: string;
  history: readonly Turn[];
  input: string;
};
/** How one connection talks to its service; `extra` adds fixed body fields. */
export type Endpoint = {
  protocol: Protocol;
  model: string;
  maxTokens: number;
  /** Earlier user turns sent along; 0 sends only the input. */
  turns: number;
  extra?: Record<string, unknown>;
};

/** Request body cap shared with the platform's `credential.request`. */
export const REQUEST_LIMIT = 65536;

export function failure(
  message: string,
  outcome?: CredentialFailureOutcome | "not-committed",
) {
  return Object.assign(new Error(message), outcome ? { outcome } : {});
}
const bytes = (value: string) => new TextEncoder().encode(value).length;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Start index of each turn; anything before the first user message is dropped. */
function turnStarts(history: readonly Turn[]) {
  return history.flatMap((turn, index) =>
    turn.role === "user" ? [index] : [],
  );
}

function body(endpoint: Endpoint, request: ChatInput, history: Turn[]) {
  const messages = [...history, { role: "user", text: request.input }].map(
    ({ role, text }) => ({
      role: role === "agent" ? "assistant" : "user",
      content: text,
    }),
  );
  const instructions = request.instructions?.trim();
  if (endpoint.protocol === "anthropic-messages")
    return JSON.stringify({
      ...endpoint.extra,
      model: endpoint.model,
      max_tokens: endpoint.maxTokens,
      ...(instructions && { system: instructions }),
      messages,
    });
  return JSON.stringify({
    ...endpoint.extra,
    model: endpoint.model,
    max_tokens: endpoint.maxTokens,
    stream: false,
    messages: [
      ...(instructions ? [{ role: "system", content: instructions }] : []),
      ...messages,
    ],
  });
}

/**
 * The request body: the newest `turns` turns, then whole old turns dropped
 * until it fits `limit`. Too large even without history is refused unsent.
 */
export function requestBody(
  endpoint: Endpoint,
  request: ChatInput,
  limit = REQUEST_LIMIT,
) {
  const starts = turnStarts(request.history);
  let first =
    endpoint.turns > 0
      ? Math.max(0, starts.length - endpoint.turns)
      : starts.length;
  for (; first <= starts.length; first++) {
    const kept = request.history.slice(starts[first] ?? request.history.length);
    const text = body(endpoint, request, kept);
    if (bytes(text) <= limit) return text;
  }
  throw failure(
    "这条消息连同角色说明超过 64 KiB，未发送；请缩短后再试。",
    "not-dispatched",
  );
}

function openaiText(parsed: unknown) {
  const choice =
    record(parsed) &&
    Array.isArray(parsed.choices) &&
    parsed.choices.length === 1
      ? parsed.choices[0]
      : null;
  if (record(choice) && choice.finish_reason === "length")
    throw failure("回复超过最大输出长度被截断，请在模型连接中调大最大输出。");
  if (
    !record(choice) ||
    choice.index !== 0 ||
    choice.finish_reason !== "stop" ||
    !record(choice.message) ||
    choice.message.role !== "assistant" ||
    typeof choice.message.content !== "string" ||
    !choice.message.content.trim() ||
    (choice.message.tool_calls != null &&
      (!Array.isArray(choice.message.tool_calls) ||
        choice.message.tool_calls.length !== 0))
  )
    return null;
  return choice.message.content;
}

function anthropicText(parsed: unknown) {
  if (!record(parsed)) return null;
  if (parsed.stop_reason === "max_tokens")
    throw failure("回复超过最大输出长度被截断，请在模型连接中调大最大输出。");
  if (
    parsed.type !== "message" ||
    parsed.role !== "assistant" ||
    !["end_turn", "stop_sequence"].includes(parsed.stop_reason as string) ||
    !Array.isArray(parsed.content)
  )
    return null;
  const blocks = parsed.content as unknown[];
  // Thinking blocks are skipped; any tool use means the reply is not plain text.
  if (blocks.some((block) => !record(block) || block.type === "tool_use"))
    return null;
  const texts = blocks.filter(
    (block) => (block as Record<string, unknown>).type === "text",
  );
  if (
    !texts.every(
      (block) => typeof (block as Record<string, unknown>).text === "string",
    )
  )
    return null;
  const text = texts.map((block) => (block as { text: string }).text).join("");
  return text.trim() ? text : null;
}

/** The reply text, or an error saying in plain words why nothing is saved. */
export function readReply(protocol: Protocol, response: unknown): string {
  if (
    !record(response) ||
    typeof response.status !== "number" ||
    !Number.isInteger(response.status) ||
    typeof response.body !== "string"
  )
    throw failure("模型服务响应格式无效，本次未保存回复。");
  if (response.status === 401 || response.status === 403)
    throw failure(
      `模型服务拒绝了请求（HTTP ${response.status}），请检查密钥是否正确、是否有该模型的权限。`,
    );
  if (response.status !== 200)
    throw failure(
      `模型服务请求失败（HTTP ${response.status}），请检查服务状态、地址与模型名。`,
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    throw failure("模型服务响应不是有效 JSON，本次未保存回复。");
  }
  const text =
    protocol === "anthropic-messages"
      ? anthropicText(parsed)
      : openaiText(parsed);
  if (text === null) throw failure("模型服务未返回完整文本，本次未保存回复。");
  return text;
}
