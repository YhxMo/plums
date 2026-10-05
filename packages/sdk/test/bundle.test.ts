import { it, expect } from "vitest";
import { ZipFile } from "yazl";
import { createArchive, validatePackage, type ManifestV2 } from "@plums/core";
import {
  createAgentBundle,
  validateAgentBundle,
  desktopContribution,
} from "../src/index.js";
const encode = (s: string) => new TextEncoder().encode(s);
const card: ManifestV2 = {
  formatVersion: "2.0",
  id: "card",
  name: "Card",
  kind: "character",
  version: "1.0.0",
  description: "",
  dependencies: [],
  permissions: [],
  payload: { unknown: { nested: true } },
};
const agent = {
  bundleVersion: "1.0" as const,
  id: "bundle",
  name: "Bundle",
  version: "1.0.0",
  character: "card.zip",
  extensions: [],
  connectors: [],
  future: { retained: true },
};
async function zipWithDirectories(manifest: ManifestV2, count: number) {
  const z = new ZipFile();
  for (let i = 0; i < count; i++) z.addEmptyDirectory(`dir-${i}/`);
  z.addBuffer(Buffer.from(JSON.stringify(manifest)), "manifest.json");
  const done = new Promise<Uint8Array>((resolve) => {
    const chunks: Buffer[] = [];
    z.outputStream.on("data", (b) => chunks.push(b));
    z.outputStream.on("end", () =>
      resolve(new Uint8Array(Buffer.concat(chunks))),
    );
  });
  z.end();
  return done;
}
it("preserves unknown outer fields, extra files and opaque character content", async () => {
  const c = await createArchive({
    "manifest.json": encode(JSON.stringify(card)),
  });
  const b = await validateAgentBundle(
    await createAgentBundle(
      agent,
      { "card.zip": c },
      { "notes.txt": encode("unknown asset") },
    ),
  );
  expect(b.agent.future).toEqual(agent.future);
  expect(new TextDecoder().decode(b.files["notes.txt"])).toBe("unknown asset");
  expect(b.packages[0]?.contents.manifest.payload).toEqual(card.payload);
});
it("counts nested directory entries against the combined archive limit", async () => {
  const c = await zipWithDirectories(card, 600);
  const extra = await zipWithDirectories({ ...card, id: "other" }, 450);
  await expect(
    createAgentBundle(
      { ...agent, characters: ["extra.zip"] },
      { "card.zip": c, "extra.zip": extra },
    ),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
});
it("rejects missing dependencies and executable entry paths before installation", async () => {
  const extension = {
    ...card,
    id: "ext",
    kind: "extension" as const,
    dependencies: [
      { id: "missing", kind: "connector" as const, range: "^1.0.0" },
    ],
    payload: { plumsDesktop: { sdkVersion: "1", runtime: "main.js" } },
  };
  const c = await createArchive({
      "manifest.json": encode(JSON.stringify(card)),
    }),
    e = await createArchive({
      "manifest.json": encode(JSON.stringify(extension)),
      "main.js": encode("export function activate(){}"),
    });
  await expect(
    createAgentBundle(
      { ...agent, extensions: ["ext.zip"] },
      { "card.zip": c, "ext.zip": e },
    ),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
  expect(() =>
    desktopContribution({
      ...extension,
      payload: { plumsDesktop: { sdkVersion: "1", runtime: "../escape.js" } },
    }),
  ).toThrow();
});
it("rejects cumulative decompression size across nested archives and secret-bearing exports", async () => {
  const c = await createArchive({
    "manifest.json": encode(JSON.stringify(card)),
    large: new Uint8Array(11 * 1024 * 1024),
  });
  const extra = await createArchive({
    "manifest.json": encode(JSON.stringify({ ...card, id: "other" })),
    large: new Uint8Array(11 * 1024 * 1024),
  });
  await expect(
    createAgentBundle(
      { ...agent, characters: ["extra.zip"] },
      { "card.zip": c, "extra.zip": extra },
    ),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
  await expect(
    createAgentBundle(
      agent,
      { "card.zip": c },
      { "secret.txt": encode("fake-private-key") },
      ["fake-private-key"],
    ),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
});

it("roundtrips empty bundles and multiple cards without requiring a default", async () => {
  const empty = { ...agent, character: undefined, characters: [] };
  expect(
    (await validateAgentBundle(await createAgentBundle(empty, {}))).packages,
  ).toEqual([]);
  const one = await createArchive({
      "manifest.json": encode(JSON.stringify(card)),
    }),
    two = await createArchive({
      "manifest.json": encode(JSON.stringify({ ...card, id: "other" })),
    });
  const result = await validateAgentBundle(
    await createAgentBundle(
      { ...empty, characters: ["one.zip", "two.zip"] },
      { "one.zip": one, "two.zip": two },
    ),
  );
  expect(result.agent.character).toBeUndefined();
  expect(result.packages.map((p) => p.contents.manifest.kind)).toEqual([
    "character",
    "character",
  ]);
  await expect(
    createAgentBundle({ ...empty, characters: ["../escape.zip"] }, {}),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
});
