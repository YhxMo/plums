import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { smokeResult } from "../package-smoke.mjs";
it("a nonexistent packaged app fails with a clear JSON error without launching Electron", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/package-smoke.mjs", "/nonexistent/synthetic/Plums.app"],
    { encoding: "utf8" },
  );
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr)).toEqual({
    ok: false,
    error:
      "Packaged Plums.app executable not found: /nonexistent/synthetic/Plums.app/Contents/MacOS/Plums",
  });
});
it("rejects missing arguments and formats one success JSON object", () => {
  const result = spawnSync(process.execPath, ["scripts/package-smoke.mjs"], {
    encoding: "utf8",
  });
  expect(result.status).not.toBe(0);
  expect(JSON.parse(result.stderr)).toMatchObject({
    ok: false,
    error: expect.stringContaining("Usage:"),
  });
  expect(smokeResult("1.0.0", 123.4, "/synthetic/Plums.app")).toEqual({
    ok: true,
    version: "1.0.0",
    ms: 123,
    appPath: "/synthetic/Plums.app",
  });
});
