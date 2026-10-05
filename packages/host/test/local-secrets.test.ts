import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import { LocalSecretStore } from "../src/secrets.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "plums-local-secrets-"),
  );
  directories.push(directory);
  return directory;
}

it("persists local credentials across restarts with private permissions and isolated Agent stores", async () => {
  const directory = await fixture(),
    location = path.join(directory, "first", "secrets"),
    store = new LocalSecretStore(location),
    other = new LocalSecretStore(path.join(directory, "second", "secrets"));
  await store.set("secret:model/apiKey", "fake-local-key");
  const reopened = new LocalSecretStore(location);
  expect(await reopened.get("secret:model/apiKey")).toBe("fake-local-key");
  expect(await other.get("secret:model/apiKey")).toBeUndefined();
  const files = await readdir(location);
  expect(files).toHaveLength(1);
  expect(await readFile(path.join(location, files[0]!), "utf8")).toBe(
    "fake-local-key",
  );
  if (process.platform !== "win32") {
    expect((await stat(location)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(location, files[0]!))).mode & 0o777).toBe(
      0o600,
    );
  }
  await reopened.delete("secret:model/apiKey");
  expect(await store.get("secret:model/apiKey")).toBeUndefined();
  expect(await readdir(location)).toEqual([]);
});

it("keeps concurrent stores and processes from overwriting other references", async () => {
  const location = path.join(await fixture(), "secrets"),
    store = new LocalSecretStore(location);
  await Promise.all(
    Array.from({ length: 16 }, (_, index) =>
      new LocalSecretStore(location).set(`local-${index}`, `fake-${index}`),
    ),
  );
  const moduleUrl = pathToFileURL(
    path.resolve("packages/host/dist/secrets.js"),
  ).href;
  await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      promisify(execFile)(process.execPath, [
        "--input-type=module",
        "-e",
        `import {LocalSecretStore} from ${JSON.stringify(moduleUrl)};const store=new LocalSecretStore(process.argv[1]);await Promise.all(Array.from({length:8},(_,n)=>store.set('child-'+process.argv[2]+'-'+n,'fake-child-'+n)));`,
        location,
        String(index),
      ]),
    ),
  );
  expect(await readdir(location)).toHaveLength(48);
  for (let index = 0; index < 16; index++)
    expect(await store.get(`local-${index}`)).toBe(`fake-${index}`);
  for (let child = 0; child < 4; child++)
    for (let index = 0; index < 8; index++)
      expect(await store.get(`child-${child}-${index}`)).toBe(
        `fake-child-${index}`,
      );
  const pending = store.set("ordered", "fake-ordered");
  expect(await new LocalSecretStore(location).get("ordered")).toBe(
    "fake-ordered",
  );
  await pending;
});

it("leaves old ciphertext unavailable without decrypting and cleans removed references", async () => {
  const directory = await fixture(),
    legacy = path.join(directory, "secrets.enc.json"),
    location = path.join(directory, "secrets");
  await writeFile(
    legacy,
    JSON.stringify({
      one: "old-ciphertext-one",
      two: "old-ciphertext-two",
      keep: "old-ciphertext-keep",
    }),
  );
  const store = new LocalSecretStore(location, legacy);
  expect(await store.get("one")).toBeUndefined();
  await store.set("one", "new-fake-key");
  expect(await store.get("one")).toBe("new-fake-key");
  await Promise.all([
    store.delete("one"),
    new LocalSecretStore(location, legacy).delete("two"),
  ]);
  expect(await store.get("one")).toBeUndefined();
  expect(JSON.parse(await readFile(legacy, "utf8"))).toEqual({
    keep: "old-ciphertext-keep",
  });
});

it.skipIf(process.platform === "win32")(
  "refuses symbolic links and reports storage failures without revealing values",
  async () => {
    const directory = await fixture(),
      location = path.join(directory, "secrets"),
      store = new LocalSecretStore(location);
    await store.set("one", "fake-private-value");
    const [name] = await readdir(location),
      external = path.join(directory, "external");
    await writeFile(external, "fake-external-value");
    await rm(path.join(location, name!));
    await symlink(external, path.join(location, name!));
    await expect(store.get("one")).rejects.toThrow(
      "Secret storage unavailable",
    );
    await store.set("one", "replacement");
    expect(await readFile(external, "utf8")).toBe("fake-external-value");
    await rm(location, { recursive: true });
    await symlink(directory, location);
    await expect(store.set("one", "fake-private-value")).rejects.toThrow(
      "Secret storage unavailable",
    );
    await expect(store.get("one")).rejects.toThrow(
      "Secret storage unavailable",
    );
  },
);
