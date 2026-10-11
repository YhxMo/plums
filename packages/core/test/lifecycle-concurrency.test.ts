import path from "node:path";
import { readFile } from "node:fs/promises";
import { MemorySecretStore, type Core } from "@plumsjs/core";
import Database from "better-sqlite3";
import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCore, manifestZip, validManifest } from "./package-helpers.js";

const gates = vi.hoisted(() => ({
  rename: undefined as
    | undefined
    | ((from: string, to: string) => Promise<void>),
  rm: undefined as undefined | ((target: string) => Promise<void>),
}));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    rename: async (...args: Parameters<typeof fs.rename>) => {
      await fs.rename(...args);
      await gates.rename?.(String(args[0]), String(args[1]));
    },
    rm: async (...args: Parameters<typeof fs.rm>) => {
      await gates.rm?.(String(args[0]));
      return fs.rm(...args);
    },
  };
});

const id = "lifecycle.test";
const cores: Core[] = [];
afterEach(() => {
  gates.rename = gates.rm = undefined;
  for (const core of cores.splice(0)) core.close();
});
function barrier() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    entered,
    release,
    pause: async () => {
      enter();
      await waiting;
    },
  };
}
const zip = (version: string, packageId = id) =>
  manifestZip(
    {
      ...validManifest("extension"),
      id: packageId,
      version,
      dependencies: [],
      permissions: [],
    },
    [{ name: "marker.txt", data: version }],
  );

describe.each(["one core", "two cores"] as const)(
  "lifecycle exclusion: %s",
  (mode) => {
    it.each(["update/update", "update/uninstall", "uninstall/import"] as const)(
      "coordinates %s without deleting another operation's files",
      async (scenario) => {
        const secrets = new MemorySecretStore();
        const { core, dataDir } = makeCore({ secrets });
        cores.push(core);
        await core.importPackage(await zip("1.0.0"));
        await core.grantConsent(id);
        await core.enable(id);
        const second =
          mode === "one core" ? core : makeCore({ dataDir, secrets }).core;
        if (second !== core) cores.push(second);
        const next = await zip("2.0.0"),
          later = await zip("3.0.0");
        const gate = barrier();
        let paused = false;
        if (scenario.startsWith("update")) {
          gates.rename = async (from) => {
            if (!paused && from === path.join(dataDir, "packages", id)) {
              paused = true;
              await gate.pause();
            }
          };
        } else {
          gates.rm = async (target) => {
            if (
              !paused &&
              path.dirname(target) === path.join(dataDir, "packages") &&
              (path.basename(target) === id ||
                path.basename(target).startsWith(".backup-"))
            ) {
              paused = true;
              await gate.pause();
            }
          };
        }
        const first = scenario.startsWith("update")
          ? core.updatePackage(next)
          : core.uninstall(id);
        // Attach a handler immediately: a failing reproduction must not leak a rejection.
        const done = first.then(
          () => undefined,
          (error) => error,
        );
        await gate.entered;
        try {
          const competing =
            scenario === "update/update"
              ? second.updatePackage(later)
              : scenario === "update/uninstall"
                ? second.uninstall(id)
                : second.importPackage(later);
          await expect(competing).rejects.toMatchObject({
            code: "IMPORT_INVALID",
            details: { id, reason: "LIFECYCLE_BUSY" },
          });
          // A per-package operation must not block an unrelated package.
          await second.importPackage(await zip("1.0.0", "independent.test"));
          const isolated = makeCore().core;
          cores.push(isolated);
          await isolated.importPackage(await zip("1.0.0"));
        } finally {
          gate.release();
          expect(await done).toBeUndefined();
        }
        if (scenario.startsWith("update")) {
          expect((await core.getPackage(id)).installed).toMatchObject({
            version: "2.0.0",
            enabled: true,
            consented: true,
          });
          expect(
            await readFile(
              path.join(dataDir, "packages", id, "marker.txt"),
              "utf8",
            ),
          ).toBe("2.0.0");
        } else {
          await second.importPackage(later);
          expect(
            await readFile(
              path.join(dataDir, "packages", id, "marker.txt"),
              "utf8",
            ),
          ).toBe("3.0.0");
          expect((await second.getPackage(id)).installed).toMatchObject({
            enabled: false,
            consented: false,
          });
        }
      },
    );
  },
);

it("fences a stale installation identity before publishing and preserves replacement files", async () => {
  const { core, dataDir } = makeCore();
  cores.push(core);
  await core.importPackage(await zip("1.0.0"));
  const gate = barrier();
  let paused = false;
  gates.rename = async (from) => {
    if (!paused && from === path.join(dataDir, "packages", id)) {
      paused = true;
      await gate.pause();
    }
  };
  const updating = core.updatePackage(await zip("2.0.0"));
  const done = updating.catch((error) => error);
  await gate.entered;
  // Simulate a replaced install even with the same version: version-only CAS is insufficient.
  const db = new Database(path.join(dataDir, "plums.db"));
  db.prepare(
    "UPDATE packages SET installation_id='replacement-identity' WHERE id=?",
  ).run(id);
  db.close();
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  await fs.mkdir(path.join(dataDir, "packages", id));
  await writeFile(
    path.join(dataDir, "packages", id, "marker.txt"),
    "replacement",
  );
  gate.release();
  expect(await done).toMatchObject({
    code: "IMPORT_INVALID",
    details: { reason: "INSTALLATION_CHANGED" },
  });
  expect(
    await readFile(path.join(dataDir, "packages", id, "marker.txt"), "utf8"),
  ).toBe("replacement");
  const check = new Database(path.join(dataDir, "plums.db"));
  expect(
    check
      .prepare("SELECT version,installation_id FROM packages WHERE id=?")
      .get(id),
  ).toEqual({ version: "1.0.0", installation_id: "replacement-identity" });
  check.close();
});
