import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const coreRequire = createRequire(
  new URL("../packages/core/package.json", import.meta.url),
);
const scriptRequire = createRequire(import.meta.url);
const packagerRequire = createRequire(
  scriptRequire.resolve("@electron/packager"),
);

export function assertPackageManifest(files) {
  for (const entry of files) {
    const name = entry.replaceAll("\\", "/").replace(/^\/+/, "").toLowerCase();
    if (
      /(^|\/)test\/fixtures(\/|$)/.test(name) ||
      /(^|\/)(escape-probe|dyld-hook|project-members)(\.[^/]+)?(\/|$)/.test(
        name,
      ) ||
      (name.endsWith(".zip") &&
        name !== "app/dist/foundation-resources/official.zip")
    )
      throw Error("Test fixture in desktop package: " + entry);
  }
}

async function zipNames(file) {
  const yauzl = coreRequire("yauzl");
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) {
        reject(error);
        return;
      }
      const names = [];
      zip.on("error", (error) => {
        zip.close();
        reject(error);
      });
      zip.on("entry", (entry) => {
        names.push(entry.fileName);
        zip.readEntry();
      });
      zip.on("end", () => resolve(names));
      zip.readEntry();
    });
  });
}

/** Current packager uses an unpacked app; also inspect ASAR if packaging changes. */
export async function checkPackageManifest(resource) {
  const files = [];
  async function visit(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name,
        file = path.join(directory, entry.name);
      files.push(name);
      if (entry.isDirectory()) await visit(file, name + "/");
      else if (entry.name.endsWith(".asar")) {
        const { listPackage } = packagerRequire("@electron/asar");
        const contents = listPackage(file).map(
          (n) => name.slice(0, -5) + "/" + n.replace(/^\/+/, ""),
        );
        files.push(...contents);
        // ZIP fixture paths in an ASAR are rejected by the same inventory guard.
      } else if (entry.name.endsWith(".zip")) {
        assertPackageManifest([name]);
        files.push(...(await zipNames(file)).map((n) => name + "/" + n));
      }
    }
  }
  await visit(resource);
  assertPackageManifest(files);
  return files;
}
