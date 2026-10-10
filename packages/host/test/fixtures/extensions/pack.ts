import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { createArchive, type ManifestV2 } from "@plumsjs/core";

export const fixturesDirectory = fileURLToPath(new URL("./", import.meta.url));
function fixturePath(name: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw Error("Invalid fixture name");
  return path.join(fixturesDirectory, name);
}

/** Only tests call this helper; no ZIP is written or installed automatically. */
export async function packExtension(name: string): Promise<Uint8Array> {
  const directory = fixturePath(name);
  const files: Record<string, Uint8Array> = {};
  async function visit(relative = ""): Promise<void> {
    for (const entry of await readdir(path.join(directory, relative), {
      withFileTypes: true,
    })) {
      const at = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await visit(at);
      else if (entry.isFile())
        files[at] = await readFile(path.join(directory, at));
      else throw Error("Fixture files must be regular files");
    }
  }
  await visit();
  return createArchive(files);
}

export async function fixtureManifest(name: string): Promise<ManifestV2> {
  return JSON.parse(
    await readFile(path.join(fixturePath(name), "manifest.json"), "utf8"),
  );
}

export async function cardFixture(name: string): Promise<Buffer> {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw Error("Invalid fixture name");
  return readFile(path.join(fixturePath("cards"), `${name}.json`));
}

/** A synthetic one-pixel PNG carrying only supplied test JSON. */
export function cardPng(
  json: Uint8Array,
  key: "chara" | "ccv3" = "ccv3",
): Buffer {
  function chunk(kind: string, data: Buffer): Buffer {
    const bytes = Buffer.concat([Buffer.from(kind), data]);
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length);
    bytes.copy(result, 4);
    result.writeUInt32BE(~crc >>> 0, result.length - 4);
    return result;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk(
      "tEXt",
      Buffer.from(`${key}\0${Buffer.from(json).toString("base64")}`),
    ),
    chunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
