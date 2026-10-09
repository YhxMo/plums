import { randomUUID } from "node:crypto";
import {
  PlumsError,
  type AgentLocalGrant,
  type LocalCredentialDeclaration,
} from "@plums/core";
export type ApprovedCredential = AgentLocalGrant["credentials"][number];
export function credentialReferences(c: ApprovedCredential): string[] {
  return [
    c.secretRef,
    c.valueRef,
    c.usernameRef,
    c.encodedValueRef,
    c.encodedUsernameRef,
  ].filter((v): v is string => typeof v === "string");
}
const fail = () =>
  new PlumsError({
    code: "PERMISSION_DENIED",
    message: "凭据不符合此声明的要求。",
  });
/** Raw and escaped scalars remain separately enumerable for redaction/export/cleanup. */
export function prepareCredential(
  packageId: string,
  declaration: LocalCredentialDeclaration,
  value: string,
  username?: string,
): { credential: ApprovedCredential; values: [string, string][] } {
  for (const text of [value, ...(username === undefined ? [] : [username])])
    if (
      typeof text !== "string" ||
      !text.length ||
      text.length > 4096 ||
      /[\x00-\x1f\x7f]/.test(text)
    )
      throw fail();
  if (
    username !== undefined &&
    !["pip-index-auth", "git-https"].includes(declaration.kind)
  )
    throw fail();
  if (declaration.kind === "git-https" && !username) throw fail();
  const prefix = `secret:${packageId}/local-${randomUUID()}/`,
    values: [string, string][] = [];
  const put = (name: string, text: string) => {
    const ref = prefix + name;
    values.push([ref, text]);
    return ref;
  };
  const credential: ApprovedCredential = {
    id: declaration.id,
    kind: declaration.kind,
    host: declaration.host,
    secretRef: put(
      "metadata",
      JSON.stringify({
        version: 1,
        kind: declaration.kind,
        host: declaration.host,
      }),
    ),
    valueRef: put("value", value),
  };
  if (username !== undefined)
    credential.usernameRef = put("username", username);
  if (["pip-index-auth", "git-https"].includes(declaration.kind)) {
    if (encodeURIComponent(value) !== value)
      credential.encodedValueRef = put(
        "encoded-value",
        encodeURIComponent(value),
      );
    if (username !== undefined && encodeURIComponent(username) !== username)
      credential.encodedUsernameRef = put(
        "encoded-username",
        encodeURIComponent(username),
      );
  }
  return { credential, values };
}
/** Trusted preparation only. No caller can use a credential approved for a different entry/host. */
export async function credentialFragments(
  grant: AgentLocalGrant,
  declarations: readonly LocalCredentialDeclaration[],
  read: (ref: string) => Promise<string | undefined>,
) {
  const result = {
    npmrc: "",
    gitCredentials: "",
    pipIndex: undefined as string | undefined,
    cargoTokens: [] as { host: string; token: string }[],
  };
  for (const credential of grant.credentials) {
    if (
      !grant.hosts.includes(credential.host) ||
      !declarations.some(
        (d) =>
          d.id === credential.id &&
          d.kind === credential.kind &&
          d.host === credential.host,
      ) ||
      !credential.valueRef
    )
      throw fail();
    const value = await read(credential.valueRef),
      username = credential.usernameRef
        ? await read(credential.usernameRef)
        : undefined;
    if (
      value === undefined ||
      (credential.usernameRef && username === undefined)
    )
      throw fail();
    // Revalidation also prevents configuration syntax injection from a corrupted secret store.
    prepareCredential(
      grant.packageId,
      { ...credential, reason: "" },
      value,
      username,
    );
    if (credential.kind === "npm-token")
      result.npmrc += `//${credential.host}/:_authToken=${value}\n`;
    if (credential.kind === "cargo-token")
      result.cargoTokens.push({ host: credential.host, token: value });
    if (credential.kind === "git-https")
      result.gitCredentials += `https://${encodeURIComponent(username!)}:${encodeURIComponent(value)}@${credential.host}\n`;
    if (credential.kind === "pip-index-auth")
      result.pipIndex = `https://${encodeURIComponent(username ?? "__token__")}:${encodeURIComponent(value)}@${credential.host}/simple`;
  }
  return result;
}
