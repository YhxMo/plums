import { ContractError } from "./errors";
import { object, string, oneOf } from "./validation";
/** Non-secret suggestions for host review. They do not create bindings or grant requests. */
export interface CredentialBindingDeclaration {
  label: string;
  target: string;
  contentType: string;
  headers: Record<string, string>;
  authentication: { type: "bearer" } | { type: "header"; name: string };
}
/** A declaration without a target; the user supplies one per connection. */
export type CredentialProtocol = Omit<CredentialBindingDeclaration, "target">;
/** Routing is host-owned, explicit, and separate from a provider's API target. */
export type NetworkRoute = { type: "direct" } | { type: "proxy"; url: string };

const token = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const forbidden = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade",
  "cookie",
  "set-cookie",
  "content-type",
]);
function invalid(path: string, message: string): never {
  throw new ContractError("extension.invalid", path, message);
}
function keys(
  value: Record<string, unknown>,
  expected: string[],
  path: string,
) {
  if (Object.keys(value).some((key) => !expected.includes(key)))
    invalid(path, "Invalid credential binding fields");
}
function header(name: string, path: string) {
  if (
    !token.test(name) ||
    name.length > 80 ||
    forbidden.has(name.toLowerCase()) ||
    name.toLowerCase().startsWith("proxy-")
  )
    invalid(path, "Invalid credential header");
}
function parseUrl(value: unknown, path: string) {
  const raw = string(value, "extension.invalid", {
    path,
    max: 512,
    label: "Invalid credential URL",
  });
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (raw !== raw.trim() || /[\u0000-\u0020\u007f\\?#]/.test(raw))
    invalid(path, "Invalid credential URL");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return invalid(path, "Invalid credential URL");
  }
  if (!url.hostname || url.username || url.password || url.search || url.hash)
    invalid(path, "Invalid credential URL");
  return url;
}
/** Rejects a target that is not a canonical HTTPS URL on the default port. */
export function validateCredentialTarget(value: unknown, path = "target") {
  const url = parseUrl(value, path);
  if (url.protocol !== "https:" || url.port || url.href !== value)
    invalid(path, "Invalid credential target");
}
/** Every field of a declaration except `target`, which `withTarget` adds. */
function validateDeclaration(
  value: unknown,
  path: string,
  withTarget: boolean,
) {
  const declaration = object(value, "extension.invalid", {
    path,
    label: "Invalid credential binding alias",
  });
  keys(
    declaration,
    [
      "label",
      ...(withTarget ? ["target"] : []),
      "contentType",
      "headers",
      "authentication",
    ],
    path,
  );
  const label = string(declaration.label, "extension.invalid", {
    path: `${path}.label`,
    max: 80,
    label: "Invalid credential binding label",
  });
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (!label.trim() || /[\u0000-\u001f\u007f]/.test(label))
    invalid(`${path}.label`, "Invalid credential binding label");
  if (withTarget)
    validateCredentialTarget(declaration.target, `${path}.target`);
  string(declaration.contentType, "extension.invalid", {
    path: `${path}.contentType`,
    max: 120,
    pattern: /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/,
    label: "Invalid credential media type",
  });
  const auth = object(declaration.authentication, "extension.invalid", {
    path: `${path}.authentication`,
    label: "Invalid credential authentication",
  });
  oneOf(auth.type, "extension.invalid", ["bearer", "header"], {
    path: `${path}.authentication.type`,
    label: "Invalid credential authentication",
  });
  keys(
    auth,
    auth.type === "bearer" ? ["type"] : ["type", "name"],
    `${path}.authentication`,
  );
  const authName = string(
    auth.type === "bearer" ? "authorization" : auth.name,
    "extension.invalid",
    {
      path: `${path}.authentication.name`,
      label: "Invalid credential authentication",
    },
  );
  header(authName, `${path}.authentication.name`);
  const headers = object(declaration.headers, "extension.invalid", {
    path: `${path}.headers`,
    label: "Invalid credential headers",
  });
  if (Object.keys(headers).length > 8)
    invalid(`${path}.headers`, "Invalid credential headers");
  const names = new Set<string>([authName.toLowerCase(), "authorization"]);
  for (const [name, content] of Object.entries(headers)) {
    const headerPath = `${path}.headers.${name}`;
    header(name, headerPath);
    string(content, "extension.invalid", {
      path: headerPath,
      max: 256,
      pattern: /^[\u0020-\u007e]*$/,
      label: "Invalid credential header value or duplicate",
    });
    if (names.has(name.toLowerCase()))
      invalid(headerPath, "Invalid credential header value or duplicate");
    names.add(name.toLowerCase());
  }
}
function entries(
  value: unknown,
  field: string,
  allowed: boolean,
  check: (value: unknown, path: string) => void,
) {
  if (value === undefined) return;
  const map = object(value, "extension.invalid", {
    path: field,
    label: "Invalid credential bindings",
  });
  if (!allowed || Object.keys(map).length > 4)
    invalid(field, "Invalid credential bindings");
  for (const [name, entry] of Object.entries(map)) {
    const path = `${field}.${name}`;
    string(name, "extension.invalid", {
      path,
      pattern: /^[a-z][a-z0-9-]{0,31}$/,
      label: "Invalid credential binding alias",
    });
    // Reserved for connections made at runtime (`credential.connect`).
    if (/^c-[a-z0-9]{8}$/.test(name))
      invalid(path, "Invalid credential binding alias");
    check(entry, path);
  }
}
export function validateCredentialBindings(
  value: unknown,
  capabilities: readonly string[] = [],
): asserts value is Record<string, CredentialBindingDeclaration> | undefined {
  entries(
    value,
    "credentialBindings",
    capabilities.includes("credential.request"),
    (entry, path) => validateDeclaration(entry, path, true),
  );
}
/** Templates the user completes with a target of their own; they need `credential.connect`. */
export function validateCredentialProtocols(
  value: unknown,
  capabilities: readonly string[] = [],
): asserts value is Record<string, CredentialProtocol> | undefined {
  entries(
    value,
    "credentialProtocols",
    capabilities.includes("credential.request") &&
      capabilities.includes("credential.connect"),
    (entry, path) => validateDeclaration(entry, path, false),
  );
}
