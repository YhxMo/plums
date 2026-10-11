import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";

const [entry, configPath] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const id = "lifecycle.test";
let stopped = false,
  committed = false;
function checkpoint(phase) {
  if (stopped || config.phase !== phase) return;
  stopped = true;
  fs.writeFileSync(config.barrier, phase);
  const end = Date.now() + 15000;
  while (!fs.existsSync(config.barrier + ".release")) {
    if (Date.now() > end) throw Error("Lifecycle test barrier timed out");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
}
const rename = fsp.rename,
  rm = fsp.rm;
fsp.rename = async (from, to) => {
  await rename(from, to);
  if (
    path.basename(String(from)) === id &&
    path.basename(String(to)).startsWith(".backup-")
  )
    checkpoint("old-moved");
  if (
    path.basename(String(from)).startsWith(".staging-") &&
    path.basename(String(to)) === id
  )
    checkpoint("new-published");
  if (
    path.basename(String(from)).startsWith(".backup-") &&
    path.basename(String(to)) === id
  )
    checkpoint("old-restored");
};
fsp.rm = async (target, options) => {
  if (committed && path.basename(String(target)).startsWith(".backup-"))
    checkpoint("before-backup-cleanup");
  if (
    config.operation === "uninstall" &&
    committed &&
    (path.basename(String(target)) === id ||
      path.basename(String(target)).startsWith(".backup-"))
  ) {
    await rm(path.join(String(target), "marker.txt"), { force: true });
    checkpoint("during-cleanup");
  }
  return rm(target, options);
};
syncBuiltinESMExports();
const { InstallStore } = await import(
  new URL("./install/store.js", pathToFileURL(entry))
);
const update = InstallStore.prototype.recordUpdate,
  remove = InstallStore.prototype.remove;
InstallStore.prototype.recordUpdate = function (...args) {
  const value = update.apply(this, args);
  committed = true;
  checkpoint("database-committed");
  return value;
};
InstallStore.prototype.remove = function (...args) {
  const value = remove.apply(this, args);
  committed = true;
  checkpoint("record-removed");
  return value;
};
const { createCore, RecordingEgressSink } = await import(pathToFileURL(entry));
const secrets = {
  async get(ref) {
    return JSON.parse(fs.readFileSync(config.secrets, "utf8"))[ref];
  },
  async set(ref, value) {
    const values = JSON.parse(fs.readFileSync(config.secrets, "utf8"));
    values[ref] = value;
    fs.writeFileSync(config.secrets, JSON.stringify(values));
  },
  async delete(ref) {
    checkpoint("before-secret");
    const values = JSON.parse(fs.readFileSync(config.secrets, "utf8"));
    delete values[ref];
    fs.writeFileSync(config.secrets, JSON.stringify(values));
    checkpoint("after-secret");
  },
};
const core = createCore({
  dataDir: config.dataDir,
  secrets,
  egress: new RecordingEgressSink(),
});
try {
  if (config.operation === "update") await core.updatePackage(config.zip);
  else if (config.operation === "import") await core.importPackage(config.zip);
  else if (config.operation === "recover") await core.listInstalled();
  else await core.uninstall(id);
  process.stdout.write(JSON.stringify({ ok: true }));
} catch (error) {
  process.stdout.write(
    JSON.stringify({ ok: false, code: error.code, details: error.details }),
  );
  process.exitCode = 1;
} finally {
  core.close();
}
