import { expect, it, vi } from "vitest";
import {
  detectToolchains,
  minimalRoot,
  type ToolchainProbe,
} from "../src/project-toolchain.js";

const probe = (files: Record<string, string>): ToolchainProbe => ({
  shellPath: async () => "/fixture/shims:/usr/bin",
  which: async (name) => files[name],
  realpath: async (file) => file,
});
it("uses the exact node version rather than the version manager", () => {
  expect(
    minimalRoot("node", "/fixture/home/.nvm/versions/node/v20/bin/node"),
  ).toBe("/fixture/home/.nvm/versions/node/v20");
});
it("uses the rust toolchain and refuses the cargo shim", async () => {
  const root = "/fixture/home/.rustup/toolchains/stable-aarch64-apple-darwin";
  expect(minimalRoot("rust", root + "/bin/rustc")).toBe(root);
  expect(minimalRoot("rust", "/fixture/home/.cargo/bin/rustc")).toBeUndefined();
  const p = probe({ rustc: root + "/bin/rustc" });
  p.realpath = vi.fn(p.realpath);
  expect(
    await detectToolchains(["rust"], { homeDir: "/fixture/home", probe: p }),
  ).toEqual([
    { name: "rust", root, executable: root + "/bin/rustc", found: true },
  ]);
  expect(p.realpath).toHaveBeenCalledWith(root + "/bin/cargo");
});
it.each([
  "/fixture/home/bin/node",
  "/fixture/home/.cargo/bin/node",
  "/fixture/home/.ssh/bin/node",
  "/fixture/bin/node",
])("rejects a root containing protected files: %s", async (node) => {
  expect(
    await detectToolchains(["node"], {
      homeDir: "/fixture/home",
      probe: probe({ node }),
    }),
  ).toEqual([
    {
      name: "node",
      root: "",
      executable: "",
      found: false,
      reason: "UNSAFE_ROOT",
    },
  ]);
});
it.each([
  [
    "git",
    "/Library/Developer/CommandLineTools/usr/bin/git",
    "/Library/Developer/CommandLineTools",
  ],
  [
    "git",
    "/opt/homebrew/Cellar/git/2.5/bin/git",
    "/opt/homebrew/Cellar/git/2.5",
  ],
  ["git", "/usr/bin/git", "/usr"],
  ["python", "/fixture/py/bin/python3.12", "/fixture/py"],
  ["go", "/fixture/go/bin/go", "/fixture/go"],
] as const)("detects %s installation roots", (name, executable, root) => {
  expect(minimalRoot(name, executable)).toBe(root);
});
it("resolves symlinks before choosing the install root", async () => {
  const p = probe({ node: "/fixture/shim/node" });
  p.realpath = async () => "/fixture/tools/node/v1/bin/node";
  expect(
    (
      await detectToolchains(["node"], { homeDir: "/fixture/home", probe: p })
    )[0],
  ).toMatchObject({
    found: true,
    root: "/fixture/tools/node/v1",
    executable: "/fixture/tools/node/v1/bin/node",
  });
});
it("shell failure leaves a tool unavailable", async () => {
  const p = probe({});
  p.shellPath = async () => {
    throw Error("fixture");
  };
  expect(
    (
      await detectToolchains(["node"], { homeDir: "/fixture/home", probe: p })
    )[0],
  ).toMatchObject({ found: false, reason: "NOT_FOUND" });
});
it("toolchain path discovery does not execute a user's shell startup files", async () => {
  const { systemToolchainProbe } = await import("../src/project-toolchain.js");
  const previousShell = process.env.SHELL,
    previousPath = process.env.PATH;
  process.env.SHELL = "/plums-fixture-do-not-execute";
  process.env.PATH = "/plums-fixture-bin:/usr/bin";
  try {
    expect(await systemToolchainProbe().shellPath()).toBe(
      "/plums-fixture-bin:/usr/bin",
    );
  } finally {
    if (previousShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = previousShell;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
});
