import { modelPath, modelProtocol } from "../../../examples/model-connector/runtime/endpoint.js";
import { connectionURL } from "../src/connection-service.js";
export { modelProtocol };
export function modelEndpoint(raw: unknown, field="endpoint", protocol="OpenAI Chat Completions", model="") { const url=connectionURL(raw,field); return url.origin+modelPath(url.pathname,protocol,model); }
