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
  /** Fixed for a known service; a custom service starts here and may switch. */
  protocol: Protocol;
  /** Base URL from the service's docs; empty for a custom service. */
  base: string;
  /** Home page, and where the user creates a key; shown as text. */
  website?: string;
  keyUrl?: string;
  /** Fixed body fields this service needs. */
  extra?: Record<string, unknown>;
  /** Context window in tokens of its usual models; the user may change it. */
  context: number;
};

export const CUSTOM = "custom";
export const presets: readonly Preset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai-chat",
    base: "https://api.deepseek.com",
    website: "https://www.deepseek.com",
    keyUrl: "https://platform.deepseek.com/api_keys",
    extra: { thinking: { type: "disabled" } },
    context: 128_000,
  },
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai-chat",
    base: "https://api.openai.com/v1",
    website: "https://openai.com",
    keyUrl: "https://platform.openai.com/api-keys",
    context: 128_000,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    protocol: "anthropic-messages",
    base: "https://api.anthropic.com",
    website: "https://www.anthropic.com",
    keyUrl: "https://console.anthropic.com/settings/keys",
    context: 1_000_000,
  },
  {
    id: "kimi",
    label: "Kimi（月之暗面）",
    protocol: "openai-chat",
    base: "https://api.moonshot.cn/v1",
    website: "https://www.moonshot.cn",
    keyUrl: "https://platform.moonshot.cn/console/api-keys",
    context: 256_000,
  },
  {
    id: "qwen",
    label: "通义千问（阿里云百炼）",
    protocol: "openai-chat",
    base: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    website: "https://bailian.console.aliyun.com",
    keyUrl: "https://bailian.console.aliyun.com",
    context: 128_000,
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    protocol: "openai-chat",
    base: "https://open.bigmodel.cn/api/paas/v4",
    website: "https://open.bigmodel.cn",
    keyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    context: 128_000,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    protocol: "openai-chat",
    base: "https://openrouter.ai/api/v1",
    website: "https://openrouter.ai",
    keyUrl: "https://openrouter.ai/settings/keys",
    context: 128_000,
  },
  {
    id: CUSTOM,
    label: "自定义",
    protocol: "openai-chat",
    base: "",
    context: 128_000,
  },
];

/** Context windows the form offers, in tokens. */
export const contextChoices = [
  32_000, 64_000, 128_000, 200_000, 256_000, 400_000, 1_000_000, 2_000_000,
] as const;

/** API formats a custom service can use, as the form names them. */
export const formats: readonly { protocol: Protocol; label: string }[] = [
  { protocol: "openai-chat", label: "OpenAI Chat Completions" },
  { protocol: "anthropic-messages", label: "Anthropic Messages" },
];
