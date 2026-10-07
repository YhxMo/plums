import { build } from "esbuild";
import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import {
  createHash,
  generateKeyPairSync,
  sign,
  createPublicKey,
} from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createArchive } from "../packages/core/dist/index.js";
import {
  OFFICIAL_FOUNDATION_PROVIDER,
  OFFICIAL_FOUNDATION_REFERENCE,
} from "../packages/host/dist/official-foundation.js";
const root = fileURLToPath(new URL("../", import.meta.url)),
  dist = path.join(root, "packages/host/dist"),
  target = path.join(dist, "foundation-resources"),
  stage = path.join(root, ".artifacts/official-foundation-build");
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await mkdir(target, { recursive: true });
// Local development signing identity stays private and is reused across builds. Release builds
// supply their own key explicitly; no private key is copied into an artifact or application.
const keyFile =
  process.env.PLUMS_OFFICIAL_SIGNING_KEY ??
  path.join(root, ".artifacts/foundation-signing/private.pem");
if (!process.env.PLUMS_OFFICIAL_SIGNING_KEY) {
  await mkdir(path.dirname(keyFile), { recursive: true, mode: 0o700 });
  try {
    await readFile(keyFile);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    const pair = generateKeyPairSync("ed25519");
    await writeFile(
      keyFile,
      pair.privateKey.export({ type: "pkcs8", format: "pem" }),
      { mode: 0o600, flag: "wx" },
    );
  }
}
const privateKey = await readFile(keyFile),
  publicKey = createPublicKey(privateKey)
    .export({ type: "spki", format: "pem" })
    .toString();
const hash = (b) => createHash("sha256").update(b).digest("hex");
const files = {};
const bundle = await build({
  metafile: true,
  minify: true,
  stdin: {
    contents:
      'export {createOfficialFoundationSession} from "./official-foundation.js"; export {PlumsError} from "@plums/core";',
    resolveDir: dist,
    sourcefile: "official-adapter.mjs",
  },
  outfile: path.join(stage, "adapter.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node26",
  banner: {
    js: "import {createRequire as __cr} from 'node:module';const require=__cr(import.meta.url);",
  },
});
files["code/adapter.mjs"] = await readFile(path.join(stage, "adapter.mjs"));
for (const name of [
  "worker.js",
  "controlled-worker.cjs",
  "controlled-supervisor.js",
  ...(process.platform === "darwin" ? ["secure-fs", "controlled-probe"] : []),
])
  files["code/" + name] = await readFile(path.join(dist, name));
// Preserve the runtime dependency bytes too. Only the targeted prebuild is carried.
const req = createRequire(path.join(root, "packages/host/package.json"));
for (const pkg of ["isolated-vm", "node-gyp-build"]) {
  const resolver =
    pkg === "node-gyp-build" ? createRequire(req.resolve("isolated-vm")) : req;
  const base = path.dirname(resolver.resolve(pkg + "/package.json"));
  for (const name of await readdir(base))
    if (name.endsWith(".js") || ["package.json", "LICENSE"].includes(name))
      files["code/node_modules/" + pkg + "/" + name] = await readFile(
        path.join(base, name),
      );
  if (pkg === "isolated-vm") {
    const platform = process.platform + "-" + process.arch,
      dir = path.join(base, "prebuilds", platform);
    for (const name of await readdir(dir))
      if (name.includes(".abi" + process.versions.modules + "."))
        files[
          "code/node_modules/" + pkg + "/prebuilds/" + platform + "/" + name
        ] = await readFile(path.join(dir, name));
  }
}
// Carry licenses for the dependencies actually visited by the standalone bundle.
const licensed = new Set();
for (const input of Object.keys(bundle.metafile.inputs))
  if (input.includes("node_modules/")) {
    let dir = path.dirname(path.resolve(process.cwd(), input));
    while (dir !== path.dirname(dir)) {
      try {
        const pkg = JSON.parse(
          await readFile(path.join(dir, "package.json"), "utf8"),
        );
        if (!licensed.has(pkg.name)) {
          licensed.add(pkg.name);
          for (const name of [
            "LICENSE",
            "LICENSE.txt",
            "LICENSE.md",
            "COPYING",
          ]) {
            try {
              files["licenses/" + pkg.name.replaceAll("/", "_") + "/" + name] =
                await readFile(path.join(dir, name));
            } catch (e) {
              if (e.code !== "ENOENT") throw e;
            }
          }
        }
        break;
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        dir = path.dirname(dir);
      }
    }
  }
files["LICENSE"] = await readFile(path.join(root, "LICENSE"));
const provider = { ...OFFICIAL_FOUNDATION_PROVIDER, entry: "code/adapter.mjs" };
files["manifest.json"] = Buffer.from(
  JSON.stringify({
    formatVersion: "2.0",
    kind: "extension",
    id: provider.id,
    name: "Plums 官方底座",
    version: OFFICIAL_FOUNDATION_REFERENCE.version,
    description: "Offline official execution adapter",
    dependencies: [],
    permissions: [],
    payload: { plumsFoundation: provider },
  }),
);
files["official.json"] = Buffer.from(
  JSON.stringify({
    artifactVersion: 1,
    adapterAbi: 1,
    nodeVersion: "26.5.1",
    platform: process.platform + "-" + process.arch,
    provider,
    version: OFFICIAL_FOUNDATION_REFERENCE.version,
    hostDigest: hash(await readFile(path.join(dist, "host-adapter/index.mjs"))),
    hostFiles: Object.fromEntries(
      await Promise.all(
        (await readdir(path.join(dist, "host-adapter")))
          .sort()
          .map(async (name) => [
            name,
            hash(await readFile(path.join(dist, "host-adapter", name))),
          ]),
      ),
    ),
  }),
);
const inventory = Object.fromEntries(
  Object.keys(files)
    .sort()
    .map((k) => [k, hash(files[k])]),
);
files["signature.json"] = Buffer.from(
  JSON.stringify({
    signatureVersion: 1,
    signature: sign(
      null,
      Buffer.from(JSON.stringify(inventory)),
      privateKey,
    ).toString("base64"),
  }),
);
const bytes = await createArchive(files),
  digest = hash(bytes);
await writeFile(path.join(target, "official.zip"), bytes);
await writeFile(
  path.join(target, "trust.json"),
  JSON.stringify(
    {
      trustVersion: 1,
      publicKeys: [
        ...new Set([
          publicKey,
          ...(process.env.PLUMS_OFFICIAL_TRUST_KEYS
            ? JSON.parse(
                await readFile(process.env.PLUMS_OFFICIAL_TRUST_KEYS, "utf8"),
              )
            : []),
        ]),
      ].map((key) => {
        if (
          typeof key !== "string" ||
          createPublicKey(key).asymmetricKeyType !== "ed25519"
        )
          throw Error("Invalid official trust key");
        return key;
      }),
      current: {
        selectionVersion: "1.0",
        source: "builtin",
        ...OFFICIAL_FOUNDATION_REFERENCE,
        digest,
      },
    },
    null,
    2,
  ) + "\n",
);
console.log("Official foundation: " + digest);
