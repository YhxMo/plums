import { PERMISSION_DENIED, CONSENT_REQUIRED, PlumsError } from "../errors.js";
import {
  requireInstalled,
  requireManifest,
  type InstallContext,
} from "../install/lifecycle.js";
import { isManifestV2, type ResourceOperation } from "../package/types.js";
export interface ResourceAccessInput {
  packageId: string;
  permissionId: string;
  scope: "agent" | "shared";
  operation: ResourceOperation;
}
export interface ResourceAccessCheckpoint {
  assertCurrent(): void;
}
/** No I/O or host qualification is granted here. The host intersects those separately. */
export function resourceAccessCheckpoint(
  ctx: InstallContext,
  input: readonly ResourceAccessInput[],
): ResourceAccessCheckpoint {
  const copied = structuredClone(input);
  const reject = (
    code: import("../errors.js").PlumsErrorCode = PERMISSION_DENIED,
  ): never => {
    throw new PlumsError({
      code,
      message: "资源调用的声明、安装或同意已失效。",
      path: "/permissions",
    });
  };
  const snapshot = () => {
    if (!Array.isArray(copied) || !copied.length || copied.length > 16)
      reject();
    return JSON.stringify([
      ctx.store.externalChangeVersion(),
      copied.map((i) => {
        if (
          !i ||
          !["read", "write", "delete"].includes(i.operation) ||
          !["agent", "shared"].includes(i.scope)
        )
          reject();
        const installed = requireInstalled(ctx, i.packageId),
          manifest = requireManifest(ctx, i.packageId);
        if (
          !installed.enabled ||
          !isManifestV2(manifest) ||
          manifest.kind === "character"
        )
          return reject();
        const p = manifest.permissions.find((p) => p.id === i.permissionId);
        if (
          !p ||
          p.kind !== "resource" ||
          (p.target !== "business" && p.target !== i.scope) ||
          !p.operations.includes(i.operation)
        )
          return reject();
        const consent = ctx.store.getConsent(i.packageId);
        if (
          !consent?.formatVersion.startsWith("2.") ||
          !consent.permissions.some(
            (c) =>
              "kind" in c &&
              c.kind === "resource" &&
              c.id === p.id &&
              c.target === p.target &&
              (c.operations as string[]).includes(i.operation),
          )
        )
          reject(CONSENT_REQUIRED);
        return [
          installed,
          manifest,
          consent,
          ctx.store.settingsRevision(i.packageId),
        ];
      }),
    ]);
  };
  const first = snapshot();
  return Object.freeze({
    assertCurrent() {
      if (snapshot() !== first) reject();
    },
  });
}
