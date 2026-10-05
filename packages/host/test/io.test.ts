import { it, expect, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { publicAddress } from "../src/io.js";
import { EncryptedSecretStore } from "../src/secrets.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
it("rejects private, reserved, mapped and transition DNS addresses", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.1.2",
    "172.16.1.1",
    "192.168.1.1",
    "198.18.1.3",
    "100.64.1.2",
    "192.0.2.1",
    "203.0.113.1",
    "::1",
    "::ffff:1.1.1.1",
    "fc00::1",
    "fe80::1",
    "2001:2::14a",
    "2001:db8::1",
    "2002:7f00:1::1",
    "3fff::1",
  ])
    expect(publicAddress(address), address).toBe(false);
  for (const address of [
    "1.1.1.1",
    "8.8.8.8",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])
    expect(publicAddress(address), address).toBe(true);
});
it("persists only ciphertext, handles concurrent writes and refuses a failed cipher", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-cipher-"));
  dirs.push(dir);
  const file = path.join(dir, "secrets.json");
  const cipher = {
    async encrypt(v: string) {
      return Buffer.from(v.split("").reverse().join("")).toString("base64");
    },
    async decrypt(v: string) {
      return Buffer.from(v, "base64").toString().split("").reverse().join("");
    },
  };
  const store = new EncryptedSecretStore(file, cipher);
  await Promise.all([
    store.set("a", "fake-key-a"),
    store.set("b", "fake-key-b"),
  ]);
  expect(await readFile(file, "utf8")).not.toContain("fake-key");
  const reopened = new EncryptedSecretStore(file, cipher);
  expect(await reopened.get("a")).toBe("fake-key-a");
  await reopened.delete("a");
  expect(await reopened.get("a")).toBeUndefined();
  const failed = new EncryptedSecretStore(file, {
    async encrypt() {
      throw Error("private error");
    },
    async decrypt() {
      throw Error("private error");
    },
  });
  await expect(failed.set("c", "new")).rejects.toThrow();
  expect(await reopened.get("c")).toBeUndefined();
  await expect(failed.get("b")).rejects.toThrow("Secret storage unavailable");
});
