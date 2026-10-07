import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const coreEntry = process.argv[2];
if (coreEntry === undefined || coreEntry === "") {
  process.stderr.write("missing core entry\n");
  process.exit(2);
}

const core = await import(pathToFileURL(coreEntry).href);
const {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  ScriptedConfirm,
  PlumsError,
} = core;

function makeCore(dataDir) {
  return createCore({
    dataDir,
    egress: new RecordingEgressSink(),
    confirm: new ScriptedConfirm(),
    secrets: new MemorySecretStore(),
  });
}

function signal(barrier, label) {
  writeFileSync(path.join(barrier, label), "ready");
}

function waitFor(barrier, label) {
  const deadline = Date.now() + 15_000;
  while (!existsSync(path.join(barrier, label))) {
    if (Date.now() > deadline) {
      process.stderr.write(`barrier timeout waiting for ${label}\n`);
      process.exit(2);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
}

const dataDir = process.env.DATA_DIR;
if (dataDir === undefined || dataDir === "") {
  process.stderr.write("missing DATA_DIR\n");
  process.exit(2);
}

if (process.env.INIT_ONLY === "1") {
  const opened = makeCore(dataDir);
  try {
    await opened.listInstalled();
  } finally {
    opened.close();
  }
  process.stdout.write(JSON.stringify({ ok: true, init: true }));
  process.exit(0);
}

const slot = process.env.SLOT;
const barrier = process.env.BARRIER;
const zipPath = process.env.ZIP_PATH;
if (slot !== "a" && slot !== "b") {
  process.stderr.write("missing SLOT\n");
  process.exit(2);
}
if (barrier === undefined || zipPath === undefined) {
  process.stderr.write("missing BARRIER or ZIP_PATH\n");
  process.exit(2);
}

const storeHref = new URL("./install/store.js", pathToFileURL(coreEntry)).href;
const { InstallStore } = await import(storeHref);
const originalRecordInstall = InstallStore.prototype.recordInstall;
// Why this wrapper stays in the test process: both inserts must start together,
// and the product code has no test-only pause.
InstallStore.prototype.recordInstall = function (manifest) {
  signal(barrier, `insert-${slot}`);
  waitFor(barrier, "insert-a");
  waitFor(barrier, "insert-b");
  return originalRecordInstall.call(this, manifest);
};

const opened = makeCore(dataDir);
const zip = new Uint8Array(readFileSync(zipPath));
// Why B waits: A is already inside recordInstall, so B's file replace cannot
// throw ENOTEMPTY and skip the insert barrier.
if (slot === "b") waitFor(barrier, "insert-a");

try {
  await opened.importPackage(zip);
  process.stdout.write(JSON.stringify({ slot, ok: true }));
} catch (err) {
  const plums = err instanceof PlumsError;
  const record =
    err !== null && typeof err === "object" ? err : { message: String(err) };
  process.stdout.write(
    JSON.stringify({
      slot,
      ok: false,
      name: record.name ?? null,
      code: "code" in record ? (record.code ?? null) : null,
      message: "message" in record ? (record.message ?? null) : null,
      path: "path" in record ? (record.path ?? null) : null,
      details: plums ? (record.details ?? null) : null,
    }),
  );
  process.exitCode = 1;
} finally {
  opened.close();
}
