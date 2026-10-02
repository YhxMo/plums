import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "@plums/core";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/main.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "../dist/main.js");
const bin = path.join(here, "../../../node_modules/.bin/plums");

describe("plums", () => {
  it("prints the core version", () => {
    expect(runCli([])).toEqual({ exitCode: 0, stdout: `${VERSION}\n`, stderr: "" });
    expect(runCli(["version"]).stdout).toBe(`${VERSION}\n`);
    expect(runCli(["--version"]).stdout).toBe(`${VERSION}\n`);
    expect(runCli(["-v"]).stdout).toBe(`${VERSION}\n`);
  });

  it("rejects commands that are not part of this skeleton", () => {
    const result = runCli(["import"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("unknown command: import\n");
  });

  it("prints the version when the built program is executed", () => {
    const direct = spawnSync(process.execPath, [dist], { encoding: "utf8" });
    expect(direct.status).toBe(0);
    expect(direct.stdout).toBe(`${VERSION}\n`);
    expect(direct.stderr).toBe("");

    const linked = spawnSync(bin, ["--version"], { encoding: "utf8" });
    expect(linked.status).toBe(0);
    expect(linked.stdout).toBe(`${VERSION}\n`);
    expect(linked.stderr).toBe("");

    const unknown = spawnSync(process.execPath, [dist, "import"], { encoding: "utf8" });
    expect(unknown.status).toBe(1);
    expect(unknown.stdout).toBe("");
    expect(unknown.stderr).toBe("unknown command: import\n");
  });
});
