import type { Protocol } from "./protocols";

/**
 * Models whose names are known to read pictures. The picture block is the
 * same on every service of a protocol, so the name decides; an unknown name
 * is treated as text-only rather than risking a refused request.
 */
const names =
  /(?:^|[^a-z0-9])(?:claude|gemini|gpt-4o|gpt-4\.1|gpt-4\.5|gpt-4-turbo|gpt-5|o[134](?:-|$)|grok-4|pixtral|llava|qvq|qwen[\w.-]*-vl|glm-[\w.-]*v(?:$|-)|[\w.-]*vision)/;

export function readsPictures(protocol: Protocol, model: string) {
  const name = model.toLowerCase();
  return protocol === "anthropic-messages"
    ? /(?:^|[^a-z])claude-/.test(name)
    : names.test(name);
}
