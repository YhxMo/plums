import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  evaluatePublicReadiness,
  REQUIRED_PUBLIC_FILES,
  scanTrackedPrivacy,
} from "../check-public-ready.mjs";

const read = (file: string) =>
  readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
function fixture() {
  const contents = new Map(
    REQUIRED_PUBLIC_FILES.map((file) => [file, "Reviewed content"]),
  );
  contents.set("LICENSE", read("LICENSE"));
  contents.set("NOTICE", read("NOTICE"));
  contents.set("THIRD_PARTY_NOTICES.txt", "Generated notices");
  contents.set(
    ".github/workflows/release.yml",
    read(".github/workflows/release.yml"),
  );
  for (const file of [
    "package.json",
    ...["core", "cli", "sdk", "host", "desktop"].map(
      (name) => `packages/${name}/package.json`,
    ),
  ])
    contents.set(file, JSON.stringify({ license: "Apache-2.0" }));
  for (const file of ["README.md", "README.zh-CN.md"])
    contents.set(file, "Plums 0.1.0 macOS 27.0.1 arm64 Node 26.5.1");
  const runtimeLicenses = new Map([
    ["node/LICENSE", "Node and V8"],
    ["LICENSE.electron", "Electron license"],
    ["LICENSES.chromium.html", "Chromium notices"],
  ]);
  const bundled = new Map([
    ...runtimeLicenses,
    ...["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.txt"].map(
      (file): [string, string] => [file, contents.get(file)!],
    ),
  ]);
  return {
    contents,
    bundled,
    runtimeLicenses,
    privacyHits: [] as { file: string; line: number }[],
    versionsOk: true,
    packagedVersion: "0.1.0",
    installerExists: true,
    inventoryOk: true,
    noticesCurrent: true,
    minimumVersion: "27.0.1",
    nodeVersion: "26.5.1",
  };
}
it("accepts reviewed inputs and refuses to treat pending metadata as ready", () => {
  expect(evaluatePublicReadiness(fixture()).ok).toBe(true);
  const input = fixture();
  input.contents.set("README.md", ["<", "OWNER", ">"].join(""));
  expect(evaluatePublicReadiness(input).failures.map((f) => f.code)).toContain(
    "PUBLIC_METADATA",
  );
});
it.each(REQUIRED_PUBLIC_FILES)("requires tracked public file %s", (file) => {
  const input = fixture();
  input.contents.delete(file);
  expect(evaluatePublicReadiness(input).failures.map((f) => f.code)).toContain(
    "MISSING_PUBLIC_FILES",
  );
});
it.each(["待用户实测", "pending user\nvalidation"])(
  "rejects unverified Gatekeeper text %s",
  (marker) => {
    const input = fixture();
    input.contents.set(".github/release-notes-template.md", marker);
    expect(
      evaluatePublicReadiness(input).failures.map((f) => f.code),
    ).toContain("PUBLIC_METADATA");
  },
);
it("reports privacy only by location and rejects an empty/invalid denylist", () => {
  const hits = scanTrackedPrivacy(
    new Map([["docs/synthetic.md", "line one\nSYNTHETIC_PRIVATE_MARKER"]]),
    ["SYNTHETIC_PRIVATE_MARKER"],
  );
  expect(hits).toEqual([{ file: "docs/synthetic.md", line: 2 }]);
  const input = fixture();
  input.privacyHits = hits;
  expect(evaluatePublicReadiness(input).failures.map((f) => f.code)).toContain(
    "PRIVACY",
  );
  expect(() => scanTrackedPrivacy(input.contents, [])).toThrow(
    "must not be empty",
  );
  expect(() => scanTrackedPrivacy(input.contents, ["("])).toThrow(
    "Invalid external denylist",
  );
});
it.each(["LICENSE", "NOTICE", "packages/sdk/package.json"])(
  "rejects license mismatch in %s",
  (file) => {
    const input = fixture();
    input.contents.set(
      file,
      file.endsWith(".json") ? '{"license":"GPL-3.0"}' : "invalid",
    );
    expect(
      evaluatePublicReadiness(input).failures.map((f) => f.code),
    ).toContain("LICENSES");
  },
);
it("requires the documented target/runtime, selected package versions and guarded workflow", () => {
  const input = fixture();
  input.minimumVersion = "28.0.0";
  expect(evaluatePublicReadiness(input).failures.map((f) => f.code)).toContain(
    "DOCUMENTED_TARGET",
  );
  input.minimumVersion = "27.0.1";
  input.nodeVersion = "22.0.0";
  expect(evaluatePublicReadiness(input).failures.map((f) => f.code)).toContain(
    "DOCUMENTED_TARGET",
  );
  input.versionsOk = false;
  expect(evaluatePublicReadiness(input).failures.map((f) => f.code)).toContain(
    "VERSIONS",
  );
  input.contents.set(
    ".github/workflows/release.yml",
    input.contents
      .get(".github/workflows/release.yml")!
      .replace(" --draft ", " "),
  );
  expect(evaluatePublicReadiness(input).failures.map((f) => f.code)).toContain(
    "RELEASE_WORKFLOW",
  );
});
it.each([
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.txt",
  "LICENSE.electron",
  "LICENSES.chromium.html",
  "node/LICENSE",
])("requires exact bundled license bytes for %s", (file) => {
  const input = fixture();
  input.bundled.delete(file);
  expect(evaluatePublicReadiness(input).failures.map((f) => f.code)).toContain(
    "BUNDLED_NOTICES",
  );
  input.bundled.set(file, "stale text");
  expect(evaluatePublicReadiness(input).failures.map((f) => f.code)).toContain(
    "BUNDLED_NOTICES",
  );
});
it("rejects stale notices, rejected package inventory and old npm scope", () => {
  const input = fixture();
  input.noticesCurrent = false;
  input.inventoryOk = false;
  input.contents.set("docs/synthetic.md", "@" + ["plums", "/core"].join(""));
  expect(evaluatePublicReadiness(input).failures.map((f) => f.code)).toEqual(
    expect.arrayContaining([
      "BUNDLED_NOTICES",
      "PACKAGE_INVENTORY",
      "NPM_SCOPE",
    ]),
  );
});
it("rejects an old packaged application or a missing preview installer", () => {
  const input = fixture();
  input.packagedVersion = "1.0.0";
  expect(evaluatePublicReadiness(input).failures.map((f) => f.code)).toContain(
    "VERSIONS",
  );
  input.packagedVersion = "0.1.0";
  input.installerExists = false;
  expect(evaluatePublicReadiness(input).failures.map((f) => f.code)).toContain(
    "VERSIONS",
  );
});
