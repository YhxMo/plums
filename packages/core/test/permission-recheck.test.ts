import { type Core } from "@plumsjs/core";
import { afterEach, expect, it } from "vitest";
import {
  expectPlumsError,
  makeCore,
  manifestZip,
  validManifest,
} from "./package-helpers.js";

let core: Core | undefined;
afterEach(() => core?.close());

it("refuses a write downgraded by an update while confirmation is pending", async () => {
  const first = {
    ...validManifest("extension"),
    dependencies: [],
    permissions: [
      {
        id: "save",
        level: "write" as const,
        target: "notes",
        reason: "Save notes.",
      },
    ],
  };
  const next = {
    ...first,
    version: "1.3.0",
    permissions: [{ ...first.permissions[0]!, level: "read" as const }],
  };
  const nextZip = await manifestZip(next);
  const made = makeCore({
    confirm: {
      async ask() {
        await core!.updatePackage(nextZip);
        return true;
      },
    },
  });
  core = made.core;
  await core.importPackage(await manifestZip(first));
  await core.grantConsent(first.id);
  await core.enable(first.id);

  const error = await expectPlumsError(
    core.runAction({ extensionId: first.id, permissionId: "save" }),
    "PERMISSION_DENIED",
    "/permissions/0",
  );
  expect(error.details).toEqual({
    id: first.id,
    permissionId: "save",
    reason: "LEVEL_MISMATCH",
  });
  expect((await core.getConsent(first.id))?.permissions).toEqual(
    next.permissions,
  );
});
