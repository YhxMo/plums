import { modelProtocols } from "./protocols.js";
function invalid(field) { throw Object.assign(Error("Invalid model settings"), {code:"SETTINGS_INVALID",path:"/settings/"+field}); }
export function modelProtocol(raw, field="protocol") { if(raw===undefined) return "OpenAI Chat Completions"; if(!modelProtocols.includes(raw)) invalid(field); return raw; }
export function modelPath(basePath, protocol="OpenAI Chat Completions", model="") { let result;
  const pathname = basePath.replace(/\/+$/, "");
  const suffix =
    protocol === "OpenAI Chat Completions"
      ? "/chat/completions"
      : protocol === "OpenAI Responses"
        ? "/responses"
        : "/messages";
  if (protocol !== "Gemini" && pathname.endsWith(suffix)) {
    return pathname;
  }
  let base = pathname.replace(/\/(chat\/completions|responses|messages)$/, "");
  if (protocol === "Gemini") {
    base = base
      .replace(/\/models\/[^/]+:generateContent$/, "")
      .replace(/\/models$/, "");
    if (!model) invalid("model");
    if (!/\/v\d+(?:beta\d*|alpha\d*)?$/.test(base)) base += "/v1beta";
    result =
      base +
      "/models/" +
      encodeURIComponent(model.replace(/^models\//, "")) +
      ":generateContent";
  } else {
    if (!/\/v\d+(?:beta\d*|alpha\d*)?$/.test(base)) base += "/v1";
    result = base + suffix;
  }
 return result;
}
