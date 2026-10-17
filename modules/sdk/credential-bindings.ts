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
export function validateCredentialBindings(
  value: unknown,
  capabilities: readonly string[] = [],
): asserts value is Record<string, CredentialBindingDeclaration> | undefined {
  if (value === undefined) return;
  const bindings = object(value, "extension.invalid", {
    path: "credentialBindings",
    label: "Invalid credential bindings",
  });
  if (
    !capabilities.includes("credential.request") ||
    Object.keys(bindings).length > 4
  )
    invalid("credentialBindings", "Invalid credential bindings");
  for (const [alias, value] of Object.entries(bindings)) {
    const path = `credentialBindings.${alias}`;
    string(alias, "extension.invalid", {
      path,
      pattern: /^[a-z][a-z0-9-]{0,31}$/,
      label: "Invalid credential binding alias",
    });
    const declaration = object(value, "extension.invalid", {
      path,
      label: "Invalid credential binding alias",
    });
    keys(
      declaration,
      ["label", "target", "contentType", "headers", "authentication"],
      path,
    );
    const label = string(declaration.label, "extension.invalid", {
      path: `${path}.label`,
      max: 80,
      label: "Invalid credential binding label",
    });
    if (!label.trim() || /[\u0000-\u001f\u007f]/.test(label))
      invalid(`${path}.label`, "Invalid credential binding label");
    const url = parseUrl(declaration.target, `${path}.target`);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.href !== declaration.target
    )
      invalid(`${path}.target`, "Invalid credential target");
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
}
