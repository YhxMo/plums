import { PlumsError, PERMISSION_DENIED } from "@plums/core";
import type { Session } from "./host.js";
import type { ComponentLibrary } from "./library.js";

/** Internal runtime/compatibility snapshot, never a content export or SDK reply. */
export async function installedComponent(
  s: Session,
  library: ComponentLibrary,
  packageId: string,
) {
  const pin = s.record.components?.find((p) => p.packageId === packageId);
  if (pin) {
    const expected = (await library.get(pin.digest)).contents;
    if (
      expected.manifest.id === pin.packageId &&
      expected.manifest.version === pin.version &&
      expected.manifest.kind === pin.kind &&
      (await s.core.matchesInstalledPackage(packageId, expected))
    )
      return expected;
  }
  throw new PlumsError({
    code: PERMISSION_DENIED,
    message: "组件安装内容与当前固定制品不一致。",
  });
}
