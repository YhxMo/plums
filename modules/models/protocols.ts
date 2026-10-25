import type { CredentialFailureOutcome } from "@modules/sdk";
import type { ChatImage, Effort } from "@extensions/contracts";
import { reasoningFields, type ThinkMode } from "./reasoning";

export type Protocol = "openai-chat" | "anthropic-messages";
export type Turn = {
  role: "user" | "agent";
  text: string;
  images?: readonly ChatImage[];
};
export type ChatInput = {
  instructions?: string;
  history: readonly Turn[];
  input: string;
  /** Pictures sent with `input`. */
  images?: readonly ChatImage[];
  /** Thinking strength; sent only if the model takes it. */
  effort?: Effort;
};
/** How one connection talks to its service; `extra` adds fixed body fields. */
export type Endpoint = {
  protocol: Protocol;
  /** Preset the provider was made from; some services' thinking fields differ. */
  preset?: string;
  /** The user's pick of how this model thinks; unset follows the rules. */
  thinking?: ThinkMode;
  model: string;
  /** Longest reply; null leaves it to the service where the protocol allows. */
  maxTokens: number | null;
  /** The model's context window in tokens, reply included. */
  context: number;
  extra?: Record<string, unknown>;
};

/** Request body cap shared with the platform's `credential.request`. */
export const REQUEST_LIMIT = 8 * 1024 * 1024;
/**
 * History may fill this share of the budget; past it, the oldest turns go
 * until it fills `REFILL`. Trimming in steps keeps the sent prefix the same
 * for many requests, so the service's prompt cache keeps hitting.
 */
const HIGH = 0.9;
const REFILL = 0.6;
/** Anthropic caches up to marked blocks; OpenAI-compatible services cache prefixes on their own. */
const cache = { type: "ephemeral" };

/** Tokens kept free for the reply: the set maximum, else a share of the window. */
export const replyRoom = ({ maxTokens, context }: Endpoint) =>
  maxTokens ?? Math.min(32_000, Math.floor(context / 4));

const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
/** Exact: 128000 → "128K", 1000000 → "1M", 131072 → "131,072", 400 → "400". */
export const tokenLabel = (tokens: number) =>
  tokens > 0 && tokens % 1_000_000 === 0
    ? `${tokens / 1_000_000}M`
    : tokens > 0 && tokens % 1000 === 0
      ? `${tokens / 1000}K`
      : grouped.format(tokens);

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

/** Tokens one picture takes from the window, whatever its bytes (about 1568 px). */
const IMAGE_TOKENS = 1600;
const imageTokens = (turn: { images?: readonly ChatImage[] }) =>
  (turn.images?.length ?? 0) * IMAGE_TOKENS;

/** `strip` leaves the picture bytes out, so the rest can be counted in tokens. */
function pictures(
  protocol: Protocol,
  images: readonly ChatImage[] | undefined,
  strip: boolean,
) {
  return (images ?? []).map(({ mime, data: bytes }) => {
    const data = strip ? "" : bytes;
    return protocol === "anthropic-messages"
      ? { type: "image", source: { type: "base64", media_type: mime, data } }
      : {
          type: "image_url",
          image_url: { url: `data:${mime};base64,${data}` },
        };
  });
}

function message(protocol: Protocol, turn: Turn, strip = false) {
  const role = turn.role === "agent" ? "assistant" : "user";
  return turn.images?.length
    ? {
        role,
        // Pictures sent alone have no text part; services refuse an empty one.
        content: [
          ...pictures(protocol, turn.images, strip),
          ...(turn.text ? [{ type: "text", text: turn.text }] : []),
        ],
      }
    : { role, content: turn.text };
}

/** Marks the last part as the end of the cached prefix. */
const last = (parts: Record<string, unknown>[]) =>
  parts.map((part, i) =>
    i === parts.length - 1 ? { ...part, cache_control: cache } : part,
  );

function body(
  endpoint: Endpoint,
  request: ChatInput,
  history: Turn[],
  strip = false,
) {
  const instructions = request.instructions?.trim();
  const thinking = reasoningFields(
    endpoint,
    request.effort,
    replyRoom(endpoint),
  );
  const { protocol } = endpoint;
  if (protocol === "anthropic-messages")
    return JSON.stringify({
      ...endpoint.extra,
      ...thinking,
      model: endpoint.model,
      // Required by Messages.
      max_tokens: replyRoom(endpoint),
      // The system prompt, and the conversation through this input, which
      // the next request repeats as its prefix.
      ...(instructions && {
        system: [{ type: "text", text: instructions, cache_control: cache }],
      }),
      messages: [
        ...history.map((turn) => message(protocol, turn, strip)),
        {
          role: "user",
          content: last([
            ...pictures(protocol, request.images, strip),
            ...(request.input ? [{ type: "text", text: request.input }] : []),
          ]),
        },
      ],
    });
  return JSON.stringify({
    ...endpoint.extra,
    ...thinking,
    model: endpoint.model,
    ...(endpoint.maxTokens !== null && { max_tokens: endpoint.maxTokens }),
    stream: false,
    messages: [
      ...(instructions ? [{ role: "system", content: instructions }] : []),
      ...[
        ...history,
        { role: "user" as const, text: request.input, images: request.images },
      ].map((turn) => message(protocol, turn, strip)),
    ],
  });
}

/**
 * The request body: the whole conversation while it fits the context window,
 * less the reply's room, and the byte cap; past that, the oldest whole turns
 * are trimmed in steps. Too large even without history is refused unsent.
 */
export function requestBody(
  endpoint: Endpoint,
  request: ChatInput,
  limit = REQUEST_LIMIT,
) {
  const room = replyRoom(endpoint);
  const budget = endpoint.context - room;
  const size = bytes(body(endpoint, request, []));
  const tokens =
    estimateTokens(body(endpoint, request, [], true)) + imageTokens(request);
  if (size > limit)
    throw failure(
      "这条消息连同角色说明超过请求大小上限（8 MiB），未发送；请缩短后再试。",
      "not-dispatched",
    );
  if (tokens > budget)
    throw failure(
      `这条消息连同角色说明约 ${tokenLabel(Math.ceil(tokens / 1000) * 1000)} token，超出上下文窗口（${tokenLabel(endpoint.context)}，其中 ${tokenLabel(room)} 留给回复），未发送；请缩短，或在模型连接中调大上下文窗口。`,
      "not-dispatched",
    );
  const { history } = request;
  const starts = turnStarts(history);
  // Each kept message adds its own JSON and one comma to the body.
  const turns = starts.map((start, index) => {
    const turn = { start, size: 0, tokens: 0 };
    for (let i = start; i < (starts[index + 1] ?? history.length); i++) {
      const { protocol } = endpoint;
      turn.size += bytes(`${JSON.stringify(message(protocol, history[i]))},`);
      turn.tokens +=
        estimateTokens(
          `${JSON.stringify(message(protocol, history[i], true))},`,
        ) + imageTokens(history[i]);
    }
    return turn;
  });
  // Replays the conversation's growth, so the first kept turn depends only on
  // earlier turns and moves only when a step is trimmed.
  let first = 0;
  let kept = { size: 0, tokens: 0 };
  const drop = () => {
    kept = {
      size: kept.size - turns[first].size,
      tokens: kept.tokens - turns[first].tokens,
    };
    first++;
  };
  const over = (share: number) =>
    kept.size > limit * share || kept.tokens > budget * share;
  for (const turn of turns) {
    kept = { size: kept.size + turn.size, tokens: kept.tokens + turn.tokens };
    if (over(HIGH)) while (over(REFILL)) drop();
  }
  // Long instructions or input may still need more room.
  while (kept.size + size > limit || kept.tokens + tokens > budget) drop();
  return body(
    endpoint,
    request,
    history.slice(turns[first]?.start ?? history.length),
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
