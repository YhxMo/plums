import type { CredentialProtocol } from "../sdk";
import type { Protocol } from "./protocols";

/** Credential templates; the user supplies each connection's target. */
export const protocols: Record<Protocol, CredentialProtocol> = {
  "openai-chat": {
    label: "OpenAI 兼容 Chat Completions",
    contentType: "application/json",
    headers: {},
    authentication: { type: "bearer" },
  },
  "anthropic-messages": {
    label: "Anthropic Messages",
    contentType: "application/json",
    headers: { "anthropic-version": "2023-06-01" },
    authentication: { type: "header", name: "x-api-key" },
  },
};

export type Preset = {
  id: string;
  label: string;
  protocol: Protocol;
  /** Empty for a custom service; the user types the address. */
  target: string;
  /** A suggestion; services rename models, so the user can change it. */
  model: string;
  /** Fixed body fields this service needs. */
  extra?: Record<string, unknown>;
};

export const presets: readonly Preset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai-chat",
    target: "https://api.deepseek.com/chat/completions",
    model: "deepseek-flash",
    extra: { thinking: { type: "disabled" } },
  },
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai-chat",
    target: "https://api.openai.com/v1/chat/completions",
    model: "gpt-5-mini",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    protocol: "anthropic-messages",
    target: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-5-5",
  },
  {
    id: "kimi",
    label: "Kimi（月之暗面）",
    protocol: "openai-chat",
    target: "https://api.moonshot.cn/v1/chat/completions",
    model: "kimi-latest",
  },
  {
    id: "qwen",
    label: "通义千问（阿里云百炼）",
    protocol: "openai-chat",
    target:
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    model: "qwen-plus",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    protocol: "openai-chat",
    target: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    model: "glm-4.6",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    protocol: "openai-chat",
    target: "https://openrouter.ai/api/v1/chat/completions",
    model: "openrouter/auto",
  },
  {
    id: "custom-openai",
    label: "自定义（OpenAI 兼容）",
    protocol: "openai-chat",
    target: "",
    model: "",
  },
  {
    id: "custom-anthropic",
    label: "自定义（Anthropic 兼容）",
    protocol: "anthropic-messages",
    target: "",
    model: "",
  },
];
