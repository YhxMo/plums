import { PlumsError, PERMISSION_DENIED } from "../errors.js";
import {
  requireInstalled,
  requireManifest,
  type InstallContext,
} from "../install/lifecycle.js";
/** Fixed synchronous checkpoint for trusted runtime identities; grants no capability. */
export function runtimeAccessCheckpoint(
  ctx: InstallContext,
  ids: readonly string[],
) {
  const copied = [...ids];
  const snapshot = () =>
    JSON.stringify([
      ctx.store.externalChangeVersion(),
      copied.map((id) => {
        const installed = requireInstalled(ctx, id);
        if (!installed.enabled)
          throw new PlumsError({
            code: PERMISSION_DENIED,
            message: "组件运行身份已失效。",
          });
        return [
          installed,
          requireManifest(ctx, id),
          ctx.store.getConsent(id),
          ctx.store.settingsRevision(id),
        ];
      }),
    ]);
  const first = snapshot();
  return Object.freeze({
    assertCurrent() {
      if (snapshot() !== first)
        throw new PlumsError({
          code: PERMISSION_DENIED,
          message: "组件运行身份已失效。",
        });
    },
  });
}
