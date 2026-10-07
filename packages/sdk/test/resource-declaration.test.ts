import { it, expect } from "vitest";
import { desktopContribution } from "../src/index.js";
import type { ManifestV2 } from "@plums/core";
const manifest: ManifestV2 = {
  formatVersion: "2.0",
  kind: "extension",
  id: "resource-fixture",
  name: "Resource",
  version: "1.0.0",
  description: "",
  dependencies: [],
  permissions: [
    {
      kind: "resource",
      id: "r",
      target: "business",
      reason: "Resources",
      operations: ["write"],
    },
  ],
  payload: {
    plumsDesktop: {
      sdkVersion: "2",
      common: {
        commonVersion: "1.0",
        features: ["resources-cas"],
        runtime: "isolate",
        resources: [
          { id: "records", permissionId: "r", operations: ["write"] },
        ],
      },
    },
  },
};
it("treats common resources as needs that cannot grant undeclared operations or settings access", () => {
  expect(
    desktopContribution(manifest)?.common?.resources?.[0]?.operations,
  ).toEqual(["write"]);
  for (const permissionId of ["missing", "r"]) {
    const m = structuredClone(manifest);
    (m.payload as any).plumsDesktop.common.resources[0] = {
      id: "records",
      permissionId,
      operations: ["read"],
    };
    expect(() => desktopContribution(m)).toThrow();
  }
  const v1 = structuredClone(manifest);
  (v1.payload as any).plumsDesktop.sdkVersion = "1";
  expect(() => desktopContribution(v1)).toThrow();
});
