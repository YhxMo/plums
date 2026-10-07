import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { cpus, release, tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  createCore,
  FakeModelProvider,
  MemorySecretStore,
  RecordingEgressSink,
  secretRef,
} from "../packages/core/dist/index.js";

const require = createRequire(
  new URL("../packages/core/package.json", import.meta.url),
);
const Database = require("better-sqlite3");
const { ZipFile } = require("yazl");
const WARMUP = 5;
const SAMPLES = 30;
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--out")) {
  throw new Error("Usage: pnpm bench:performance [--out <report.json>]");
}

const probe = new Database(":memory:");
const statementPrototype = Object.getPrototypeOf(probe.prepare("SELECT 1"));
const sqliteVersion = probe
  .prepare("SELECT sqlite_version() AS version")
  .get().version;
probe.close();
const report = {
  environment: {
    node: process.version,
    sqlite: sqliteVersion,
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    cpu: cpus()[0]?.model,
    gc: typeof global.gc === "function",
  },
  methodology: {
    warmup: WARMUP,
    samples: SAMPLES,
    memory:
      "Maximum observed increase after a call; not a continuous peak measurement",
  },
  results: [],
};
console.log(
  JSON.stringify({
    environment: report.environment,
    methodology: report.methodology,
  }),
);

function manifest(id) {
  return {
    formatVersion: "2.0",
    kind: "extension",
    id,
    name: "Synthetic benchmark",
    version: "1.0.0",
    description: "Synthetic fixture",
    dependencies: [],
    permissions: [
      {
        id: "send",
        kind: "egress",
        target: "api.example.com",
        reason: "Synthetic measurement",
      },
    ],
    payload: {},
  };
}

function zipManifest(value) {
  const zip = new ZipFile();
  const done = new Promise((resolve, reject) => {
    const chunks = [];
    zip.outputStream.on("data", (chunk) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
  zip.addBuffer(Buffer.from(JSON.stringify(value)), "manifest.json");
  zip.end();
  return done;
}

async function world(run) {
  const parent = await mkdtemp(path.join(tmpdir(), "plums-bench-"));
  const memory = new MemorySecretStore();
  const egress = new RecordingEgressSink();
  let secretGets = 0;
  const core = createCore({
    dataDir: path.join(parent, "data"),
    model: new FakeModelProvider(),
    egress,
    confirm: {
      async ask() {
        return true;
      },
    },
    onAudit() {},
    secrets: {
      get(ref) {
        secretGets++;
        return memory.get(ref);
      },
      set: (ref, value) => memory.set(ref, value),
      delete: (ref) => memory.delete(ref),
    },
  });
  try {
    return await run({ core, memory, egress, getSecretGets: () => secretGets });
  } finally {
    core.close();
    await rm(parent, { recursive: true, force: true });
  }
}

async function measure(call) {
  for (let i = 0; i < WARMUP; i++) await call();
  global.gc?.();
  const before = process.memoryUsage();
  const peak = { rss: 0, heapUsed: 0, external: 0 };
  const times = [];
  for (let i = 0; i < SAMPLES; i++) {
    const start = performance.now();
    await call();
    times.push(performance.now() - start);
    const memory = process.memoryUsage();
    for (const key of Object.keys(peak))
      peak[key] = Math.max(peak[key], memory[key] - before[key]);
  }
  times.sort((a, b) => a - b);
  return {
    medianMs: +times[Math.floor(times.length / 2)].toFixed(3),
    p95Ms: +times[Math.ceil(times.length * 0.95) - 1].toFixed(3),
    observedMemoryIncreaseBytes: peak,
  };
}

// Count executions separately: a cached statement can execute many times without another prepare.
async function sqlMetrics(call) {
  const prepare = Database.prototype.prepare;
  const get = statementPrototype.get;
  const all = statementPrototype.all;
  let prepares = 0;
  let selects = 0;
  Database.prototype.prepare = function (...args) {
    prepares++;
    return prepare.apply(this, args);
  };
  statementPrototype.get = function (...args) {
    if (/^\s*SELECT\b/i.test(this.source)) selects++;
    return get.apply(this, args);
  };
  statementPrototype.all = function (...args) {
    if (/^\s*SELECT\b/i.test(this.source)) selects++;
    return all.apply(this, args);
  };
  try {
    await call();
    return { selects, prepares };
  } finally {
    Database.prototype.prepare = prepare;
    statementPrototype.get = get;
    statementPrototype.all = all;
  }
}

function record(result) {
  report.results.push(result);
  console.log(JSON.stringify(result));
}

for (const fields of [10, 50, 100]) {
  await world(async ({ core, getSecretGets }) => {
    const value = manifest("settings-bench");
    const values = {};
    value.settingsSchema = { type: "object", properties: {} };
    for (let i = 0; i < fields; i++) {
      value.settingsSchema.properties[`value-${i}`] = {
        type: "integer",
        title: "Value",
        description: "Synthetic setting",
        minimum: 0,
        maximum: 100 + i,
      };
      values[`value-${i}`] = 5;
    }
    await core.importPackage(await zipManifest(value));
    const call = () => core.setSettings(value.id, values);
    const timing = await measure(call);
    const before = getSecretGets();
    const sql = await sqlMetrics(call);
    record({
      scenario: "setSettings",
      fields,
      ...timing,
      ...sql,
      secretGets: getSecretGets() - before,
    });
  });
}

const capabilityCases = [1, 100, 500].flatMap((packages) =>
  [0, 1, 4].map((refsPerPackage) => ({
    packages,
    refsPerPackage,
    payloadBytes: 0,
  })),
);
capabilityCases.push({
  packages: 100,
  refsPerPackage: 1,
  payloadBytes: 64 * 1024,
});
for (const fixture of capabilityCases) {
  await world(async ({ core, memory, egress, getSecretGets }) => {
    await core.listInstalled();
    // Batch metadata fixtures outside measurement; only the public capability call is timed.
    const db = new Database(path.join(core.dataDir, "plums.db"));
    try {
      const insert = db.prepare(
        "INSERT INTO packages (id,kind,name,version,manifest,enabled,installed_at,secret_refs) VALUES (?,?,?,?,?,0,?,?)",
      );
      db.transaction(() => {
        for (let i = 0; i < fixture.packages; i++) {
          const value = manifest(i === 0 ? "capability-bench" : `fixture-${i}`);
          value.payload = "x".repeat(fixture.payloadBytes);
          value.settingsSchema = { type: "object", properties: {} };
          const refs = [];
          for (let j = 0; j < fixture.refsPerPackage; j++) {
            value.settingsSchema.properties[`token-${j}`] = {
              type: "string",
              title: "Token",
              description: "Synthetic secret",
              "x-secret": true,
            };
            refs.push(secretRef(value.id, `token-${j}`));
          }
          insert.run(
            value.id,
            value.kind,
            value.name,
            value.version,
            JSON.stringify(value),
            "2000-01-01T00:00:00.000Z",
            JSON.stringify(refs),
          );
        }
      })();
    } finally {
      db.close();
    }
    for (let i = 0; i < fixture.packages; i++) {
      for (let j = 0; j < fixture.refsPerPackage; j++) {
        await memory.set(
          secretRef(
            i === 0 ? "capability-bench" : `fixture-${i}`,
            `token-${j}`,
          ),
          `fake-benchmark-${i}-${j}`,
        );
      }
    }
    await core.grantConsent("capability-bench");
    await core.enable("capability-bench");
    const call = async () => {
      await core.runCapability({
        extensionId: "capability-bench",
        permissionId: "send",
        request: { kind: "egress", url: "https://api.example.com/synthetic" },
      });
      egress.records.length = 0;
    };
    const timing = await measure(call);
    const before = getSecretGets();
    const sql = await sqlMetrics(call);
    record({
      scenario: "runCapability",
      ...fixture,
      ...timing,
      ...sql,
      secretGets: getSecretGets() - before,
    });
  });
}

if (args.length !== 0)
  await writeFile(
    path.resolve(args[1]),
    `${JSON.stringify(report, null, 2)}\n`,
  );
