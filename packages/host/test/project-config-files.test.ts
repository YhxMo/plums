import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  lstat,
  link,
  symlink,
  writeFile,
  rm,
} from "node:fs/promises";
import path from "node:path";
import {
  readProjectConfiguration,
  writeProjectConfiguration,
} from "../src/project-config-files.js";
const native = process.platform === "darwin" && process.arch === "arm64";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp("/private/tmp/plums-config-files-");
  roots.push(root);
  const home = path.join(root, "home"),
    generated = path.join(root, "generated"),
    cargo = path.join(root, "cargo");
  await Promise.all(
    [home, generated, cargo].map((p) => mkdir(p, { mode: 0o700 })),
  );
  return { root, home, generated, cargo };
}
it.runIf(native)(
  "reads only allowed synthetic fields, never follows includes or copies authentication",
  async () => {
    const f = await fixture();
    await mkdir(path.join(f.home, ".cargo"));
    await mkdir(path.join(f.home, ".config/pip"), { recursive: true });
    await writeFile(
      path.join(f.home, ".gitconfig"),
      '[user]\n name = "Fixture"\n email = fixture@example.test\n[include]\n path = /no/such/file\n[credential]\n helper = !touch should-not-exist\n',
    );
    await writeFile(
      path.join(f.home, ".npmrc"),
      "registry=https://pkg.example.test/\n@scope:registry=https://scope.example.test/\n//pkg.example.test/:_authToken=SYNTHETIC_TOKEN\n_auth=SYNTHETIC_TOKEN\n",
    );
    await writeFile(
      path.join(f.home, ".cargo/config.toml"),
      '[registries.fixture]\nindex = "https://cargo.example.test/index"\n[source.crates-io]\nreplace-with = "fixture"\n[build]\nrustc-wrapper = "malicious"\n',
    );
    await writeFile(
      path.join(f.home, ".config/pip/pip.conf"),
      "[global]\nindex-url=https://user:SYNTHETIC_TOKEN@pip.example.test/simple\ntrusted-host=pip.example.test\n",
    );
    const items = await readProjectConfiguration(f.home);
    expect(items).toContainEqual({
      tool: "git",
      field: "user.name",
      value: "Fixture",
    });
    expect(items).toContainEqual({
      tool: "cargo",
      field: "source.crates-io.replace-with",
      value: "fixture",
    });
    expect(JSON.stringify(items)).not.toMatch(
      /SYNTHETIC_TOKEN|malicious|no\/such\/file/,
    );
    const env = await writeProjectConfiguration(f.generated, f.cargo, items);
    expect(env.HOME).toBe(f.generated);
    expect(env.CARGO_HOME).toBe(f.cargo);
    for (const file of [
      path.join(f.generated, ".gitconfig"),
      path.join(f.generated, ".npmrc"),
      env.PIP_CONFIG_FILE!,
      path.join(f.cargo, "config.toml"),
    ]) {
      expect((await lstat(file)).mode & 0o777).toBe(0o600);
      expect(await readFile(file, "utf8")).not.toContain("SYNTHETIC_TOKEN");
    }
  },
);
it.runIf(native).each(["symlink", "hardlink", "large", "fifo"])(
  "rejects a %s configuration without exposing contents",
  async (kind) => {
    const f = await fixture(),
      outside = path.join(f.root, "outside"),
      file = path.join(f.home, ".npmrc");
    await writeFile(outside, "SYNTHETIC_TOKEN");
    if (kind === "symlink") await symlink(outside, file);
    if (kind === "hardlink") await link(outside, file);
    if (kind === "large") await writeFile(file, "x".repeat(128 * 1024 + 1));
    if (kind === "fifo") {
      const { spawnSync } = await import("node:child_process");
      expect(spawnSync("/usr/bin/mkfifo", [file]).status).toBe(0);
    }
    const error = await readProjectConfiguration(f.home).catch((e) => e);
    expect(error).toMatchObject({
      code: "TIER_UNAVAILABLE",
      details: { reason: "PROJECT_CONFIGURATION_UNSAFE" },
    });
    expect(JSON.stringify(error)).not.toContain("SYNTHETIC_TOKEN");
  },
);
it.runIf(native)(
  "rejects symlinked parents and preserves the previous generated file on failure",
  async () => {
    const f = await fixture();
    await writeProjectConfiguration(f.generated, f.cargo, [
      { tool: "npm", field: "registry", value: "https://old.example.test/" },
    ]);
    const outside = path.join(f.root, "outside");
    await writeFile(outside, "sentinel");
    await rm(path.join(f.generated, ".npmrc"));
    await symlink(outside, path.join(f.generated, ".npmrc"));
    await expect(
      writeProjectConfiguration(f.generated, f.cargo, []),
    ).rejects.toMatchObject({ code: "TIER_UNAVAILABLE" });
    expect(await readFile(outside, "utf8")).toBe("sentinel");
    await symlink(f.home, path.join(f.root, "alias"));
    await expect(
      readProjectConfiguration(path.join(f.root, "alias")),
    ).rejects.toMatchObject({ code: "TIER_UNAVAILABLE" });
  },
);
it.runIf(native)(
  "does not create generated directories through a symlinked configuration parent",
  async () => {
    const f = await fixture(),
      outside = path.join(f.root, "outside-directory");
    await mkdir(outside);
    await symlink(outside, path.join(f.generated, ".config"));
    await expect(
      writeProjectConfiguration(f.generated, f.cargo, []),
    ).rejects.toMatchObject({ code: "TIER_UNAVAILABLE" });
    await expect(lstat(path.join(outside, "pip"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);
