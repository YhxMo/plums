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

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
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
function keys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).some((key) => !expected.includes(key)))
    throw Error("Invalid credential binding fields");
}
function header(name: string) {
  if (
    !token.test(name) ||
    name.length > 80 ||
    forbidden.has(name.toLowerCase()) ||
    name.toLowerCase().startsWith("proxy-")
  )
    throw Error("Invalid credential header");
}
function parseUrl(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    value !== value.trim() ||
    /[\u0000-\u0020\u007f\\?#]/.test(value)
  )
    throw Error("Invalid credential URL");
  const url = new URL(value);
  if (!url.hostname || url.username || url.password || url.search || url.hash)
    throw Error("Invalid credential URL");
  return url;
}
export function validateCredentialBindings(
  value: unknown,
  capabilities: readonly string[] = [],
): asserts value is Record<string, CredentialBindingDeclaration> | undefined {
  if (value === undefined) return;
  if (
    !object(value) ||
    !capabilities.includes("credential.request") ||
    Object.keys(value).length > 4
  )
    throw Error("Invalid credential bindings");
  for (const [alias, declaration] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(alias) || !object(declaration))
      throw Error("Invalid credential binding alias");
    keys(declaration, [
      "label",
      "target",
      "contentType",
      "headers",
      "authentication",
    ]);
    if (
      typeof declaration.label !== "string" ||
      !declaration.label.trim() ||
      declaration.label.length > 80 ||
      /[\u0000-\u001f\u007f]/.test(declaration.label)
    )
      throw Error("Invalid credential binding label");
    const url = parseUrl(declaration.target);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.href !== declaration.target
    )
      throw Error("Invalid credential target");
    if (
      typeof declaration.contentType !== "string" ||
      !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(
        declaration.contentType,
      ) ||
      declaration.contentType.length > 120
    )
      throw Error("Invalid credential media type");
    const auth = declaration.authentication;
    if (!object(auth) || (auth.type !== "bearer" && auth.type !== "header"))
      throw Error("Invalid credential authentication");
    keys(auth, auth.type === "bearer" ? ["type"] : ["type", "name"]);
    const authName = auth.type === "bearer" ? "authorization" : auth.name;
    if (typeof authName !== "string")
      throw Error("Invalid credential authentication");
    header(authName);
    if (
      !object(declaration.headers) ||
      Object.keys(declaration.headers).length > 8
    )
      throw Error("Invalid credential headers");
    const names = new Set<string>([authName.toLowerCase(), "authorization"]);
    for (const [name, content] of Object.entries(declaration.headers)) {
      header(name);
      if (
        names.has(name.toLowerCase()) ||
        typeof content !== "string" ||
        content.length > 256 ||
        /[^\u0020-\u007e]/.test(content)
      )
        throw Error("Invalid credential header value or duplicate");
      names.add(name.toLowerCase());
    }
  }
}
