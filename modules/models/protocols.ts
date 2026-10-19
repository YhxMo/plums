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
  /** The model's context window in tokens, reply included. */
  context: number;
  /** Earlier turns sent along; 0 sends only the input, null all that fit. */
  turns: number | null;
  extra?: Record<string, unknown>;
};

/** Request body cap shared with the platform's `credential.request`. */
export const REQUEST_LIMIT = 8 * 1024 * 1024;

/** 1000000 → "1M", 128000 → "128K". */
export const tokenLabel = (tokens: number) =>
  tokens % 1_000_000 === 0
    ? `${tokens / 1_000_000}M`
    : tokens % 1000 === 0
      ? `${tokens / 1000}K`
      : String(tokens);

/**
 * A deliberately high token count, so a request stays inside the window:
 * one per non-ASCII character (CJK runs about one or fewer) and one per 2.5
 * ASCII characters (English runs about three to four).
 */
export function estimateTokens(text: string) {
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) ascii++;
    // The second half of a surrogate pair belongs to the same character.
    else if (code < 0xdc00 || code > 0xdfff) other++;
  }
  return Math.ceil(ascii / 2.5) + other;
}

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

const message = ({ role, text }: Turn) => ({
  role: role === "agent" ? "assistant" : "user",
  content: text,
});

function body(endpoint: Endpoint, request: ChatInput, history: Turn[]) {
  const messages = [
    ...history,
    { role: "user" as const, text: request.input },
  ].map(message);
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
 * The request body: the newest whole turns that fit both the context window,
 * less the reply's room, and the byte cap, at most `turns` of them. Too large
 * even without history is refused unsent.
 */
export function requestBody(
  endpoint: Endpoint,
  request: ChatInput,
  limit = REQUEST_LIMIT,
) {
  const budget = endpoint.context - endpoint.maxTokens;
  const bare = body(endpoint, request, []);
  let size = bytes(bare);
  let tokens = estimateTokens(bare);
  if (size > limit)
    throw failure(
      "这条消息连同角色说明超过请求大小上限（8 MiB），未发送；请缩短后再试。",
      "not-dispatched",
    );
  if (tokens > budget)
    throw failure(
      `这条消息连同角色说明约 ${tokenLabel(Math.ceil(tokens / 1000) * 1000)} token，超出上下文窗口（${tokenLabel(endpoint.context)}，其中 ${endpoint.maxTokens} 留给回复），未发送；请缩短，或在模型连接中调大上下文窗口。`,
      "not-dispatched",
    );
  const { history } = request;
  const starts = turnStarts(history);
  const allowed = endpoint.turns ?? starts.length;
  let first = history.length;
  // Each kept message adds its own JSON and one comma to the body.
  for (
    let turn = starts.length - 1;
    turn >= 0 && starts.length - turn <= allowed;
    turn--
  ) {
    let more = 0;
    let moreTokens = 0;
    for (let i = starts[turn]; i < first; i++) {
      const json = `${JSON.stringify(message(history[i]))},`;
      more += bytes(json);
      moreTokens += estimateTokens(json);
    }
    if (size + more > limit || tokens + moreTokens > budget) break;
    size += more;
    tokens += moreTokens;
    first = starts[turn];
  }
  return body(endpoint, request, history.slice(first));
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
