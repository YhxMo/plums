import { spawn, spawnSync, fork } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  symlink,
  rm,
  open,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const self = fileURLToPath(import.meta.url);
const repo = path.dirname(path.dirname(self));

// The trusted prototype supervisor never loads component code. IPC loss cleans its group.
if (process.argv[2] === "--supervisor") {
  let child,
    stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (!child?.pid) return process.exit(0);
    const kill = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {}
    };
    kill("SIGTERM");
    const timer = setTimeout(() => kill("SIGKILL"), 300);
    child.once("exit", () => {
      clearTimeout(timer);
      process.exit(0);
    });
  };
  process.on("disconnect", stop);
  process.on("SIGTERM", stop);
  process.on("message", (m) => {
    if (m.type === "stop") return stop();
    if (child || stopping) return;
    child = spawn(
      "/usr/bin/sandbox-exec",
      ["-p", m.profile, m.binary, "hold"],
      {
        cwd: m.cwd,
        env: {},
        detached: true,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    child.stdout.once("data", () =>
      process.send?.({ type: "ready", pid: child.pid }),
    );
    child.on("error", stop);
    child.on("exit", () => {
      if (!stopping) process.exit(1);
    });
  });
} else {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw Error("This evidence requires macOS arm64.");
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "plums-boundary-")),
  );
  let tcp, unix, heldDescriptor;
  const previousMarker = process.env.PLUMS_FIXTURE_SECRET;
  process.env.PLUMS_FIXTURE_SECRET = "fixture-only";
  let signalHits = 0;
  const signalObserver = () => signalHits++;
  process.on("SIGUSR2", signalObserver);
  const checks = [];
  const check = (name, condition) => {
    assert.ok(condition, name);
    checks.push(name);
  };
  const quote = (value) => {
    assert.ok(!/[\x00-\x1f]/.test(value));
    return JSON.stringify(value);
  };
  const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const node = await realpath(process.execPath);
  const runtimeReads = new Set([
    node,
    path.resolve(path.dirname(node), "../lib"),
  ]);
  const runtimeLinks = new Set();
  // Pin library locations instead of granting the whole Homebrew installation.
  const queue = [node],
    visited = new Set();
  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    const output = spawnSync("/usr/bin/otool", ["-L", file], {
      encoding: "utf8",
    });
    assert.equal(output.status, 0);
    for (const line of output.stdout.split("\n").slice(1)) {
      const dep = line.trim().split(" (")[0];
      if (!dep.startsWith("/opt/homebrew/")) continue;
      const canonical = await realpath(dep);
      runtimeReads.add(path.dirname(dep));
      runtimeReads.add(path.dirname(canonical));
      runtimeLinks.add(path.dirname(path.dirname(dep)));
      queue.push(canonical);
    }
  }
  function profile(binary, readRoots = [], writeRoots = []) {
    const runtime =
      binary === node
        ? [
            ...[...runtimeReads].map((p) => `(subpath ${quote(p)})`),
            ...[...runtimeLinks].map((p) => `(literal ${quote(p)})`),
          ].join(" ")
        : "";
    return `(version 1)(deny default)
      (allow file-read* (literal "/") (subpath "/usr/lib") (subpath "/System/Library") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random") (literal ${quote(binary)}) ${runtime} ${readRoots.map((p) => `(subpath ${quote(p)})`).join(" ")})
      ${writeRoots.length ? `(allow file-write* ${writeRoots.map((p) => `(subpath ${quote(p)})`).join(" ")})` : ""}
      (allow process-exec (literal ${quote(binary)}))(allow sysctl-read)(allow process-info* (target self))`;
  }
  async function run(binary, args, p, extraDescriptor) {
    return await new Promise((resolve, reject) => {
      const child = spawn(
        p === null ? binary : "/usr/bin/sandbox-exec",
        p === null ? args : ["-p", p, binary, ...args],
        {
          cwd: root,
          env: {},
          detached: true,
          stdio:
            extraDescriptor === undefined
              ? ["ignore", "pipe", "pipe"]
              : ["ignore", "pipe", "pipe", extraDescriptor],
        },
      );
      let stdout = "",
        stderr = "";
      const timer = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
        reject(Error("Probe timeout"));
      }, 8000);
      child.stdout.on("data", (c) => (stdout += c));
      child.stderr.on("data", (c) => (stderr += c));
      child.on("error", reject);
      child.on("exit", (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal, stdout, stderr });
      });
    });
  }
  try {
    for (const dir of ["read", "scratch", "outside", "agent-b", "write-only"])
      await mkdir(path.join(root, dir));
    const allowed = path.join(root, "read", "data"),
      outside = path.join(root, "outside", "data"),
      other = path.join(root, "agent-b", "data"),
      writeOnly = path.join(root, "write-only", "data");
    for (const f of [allowed, outside, other, writeOnly])
      await writeFile(f, "fixture");
    const link = path.join(root, "read", "other-link");
    await symlink(other, link);
    let networkHits = 0;
    tcp = net.createServer((socket) => {
      networkHits++;
      socket.end();
    });
    await new Promise((resolve) => tcp.listen(0, "127.0.0.1", resolve));
    const port = tcp.address().port;
    unix = net.createServer((socket) => {
      networkHits++;
      socket.end();
    });
    const socketPath = path.join(root, "mock.sock");
    await new Promise((resolve) => unix.listen(socketPath, resolve));
    const binary = path.join(root, "probe");
    const build = spawnSync(
      "/usr/bin/clang",
      [
        "-Wall",
        "-Wextra",
        "-Werror",
        path.join(
          repo,
          "packages/host/test/fixtures/controlled-execution-probe.c",
        ),
        "-o",
        binary,
      ],
      { encoding: "utf8" },
    );
    assert.equal(build.status, 0, build.stderr);
    const readRoots = [path.join(root, "read"), path.join(root, "scratch")],
      writeRoots = [path.join(root, "scratch"), path.join(root, "write-only")];
    const marker = path.join(root, "scratch", "escaped");
    const args = [
      allowed,
      outside,
      other,
      link,
      path.join(root, "scratch", "data"),
      path.join(root, "outside", "written"),
      writeOnly,
      String(port),
      socketPath,
      String(process.pid),
      `echo escaped > ${shellQuote(marker)}`,
    ];
    heldDescriptor = await open(outside, "r");
    check(
      "parent contains synthetic environment marker",
      process.env.PLUMS_FIXTURE_SECRET === "fixture-only",
    );
    const control = await run(binary, args, null, heldDescriptor.fd);
    check("unsandboxed fixture control starts", control.code === 0);
    const baseline = JSON.parse(
      control.stdout.split("\n").find((line) => line.startsWith("{")),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    check(
      "positive control actually delivers harmless signal",
      signalHits === 1,
    );
    check(
      "session leader cannot create a new session even without sandbox",
      baseline.setsid === 0,
    );
    for (const name of [
      "readOutside",
      "readOtherAgent",
      "readSymlink",
      "writeOutside",
      "readWriteOnly",
      "writeReadOnly",
      "tcp",
      "udp6",
      "unix",
      "fork",
      "spawn",
      "signalHost",
    ])
      check(`positive control ${name}`, baseline[name] === 1);
    check(
      "positive control inherited descriptor detection",
      baseline.inheritedDescriptors === 1,
    );
    check(
      "positive control local listeners receive connections",
      networkHits === 2,
    );
    check(
      "positive control exec can create fixture marker",
      (await readFile(marker, "utf8")) === "escaped\n",
    );
    await rm(marker);
    for (const f of [allowed, outside, other, writeOnly])
      await writeFile(f, "fixture");
    networkHits = 0;
    signalHits = 0;
    const unavailable = await run(
      binary,
      args,
      "(version 1)(invalid-probe-operation)",
    );
    check(
      "invalid sandbox refuses startup without executing code",
      unavailable.code !== 0 && unavailable.stdout === "",
    );
    const native = await run(
      binary,
      args,
      profile(binary, readRoots, writeRoots),
    );
    check("native command starts", native.code === 0);
    check("in-process exec denied", native.stdout.includes("execDenied"));
    let markerExists = true;
    try {
      await readFile(marker);
    } catch (e) {
      if (e.code === "ENOENT") markerExists = false;
      else throw e;
    }
    check("denied exec creates no fixture marker", !markerExists);
    const results = JSON.parse(native.stdout.split("\n")[0]);
    for (const [name, result] of Object.entries(results))
      check(
        `native ${name}`,
        result === (["readAllowed", "writeScratch"].includes(name) ? 1 : 0),
      );
    const source = `const fs=require('node:fs'),cp=require('node:child_process'),net=require('node:net');
      const denied=f=>{try{f();return false}catch{return true}};
      const checks={readAllowed:fs.readFileSync(${quote(allowed)},'utf8')==='fixture',readOutside:denied(()=>fs.readFileSync(${quote(outside)})),readOtherAgent:denied(()=>fs.readFileSync(${quote(other)})),readSymlink:denied(()=>fs.readFileSync(${quote(link)})),writeOutside:denied(()=>fs.writeFileSync(${quote(outside)},'x')),readWriteOnly:denied(()=>fs.readFileSync(${quote(writeOnly)})),spawn:!!cp.spawnSync('/bin/echo',['fixture']).error,detachedSpawn:!!cp.spawnSync(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true}).error,environment:!process.env.PLUMS_FIXTURE_SECRET};
      const socket=net.connect(${port},'127.0.0.1');socket.once('error',()=>{checks.tcp=true;console.log(JSON.stringify(checks))});socket.once('connect',()=>{checks.tcp=false;socket.end();console.log(JSON.stringify(checks))});`;
    const background = await run(
      node,
      ["--openssl-config=/dev/null", "-e", source],
      profile(node, readRoots, writeRoots),
    );
    assert.equal(
      background.code,
      0,
      background.stderr.replaceAll(root, "<fixture>"),
    );
    check("controlled Node starts", background.code === 0);
    for (const [name, result] of Object.entries(JSON.parse(background.stdout)))
      check(`node ${name}`, result === true);
    check("mock network received no bypass traffic", networkHits === 0);
    check(
      "sandbox actually blocks signal delivery to probe host",
      signalHits === 0,
    );
    check(
      "denied external file remains unchanged",
      (await readFile(outside, "utf8")) === "fixture",
    );
    check(
      "read-only file remains unchanged",
      (await readFile(allowed, "utf8")) === "fixture",
    );
    // A positively authorized operation is performed by a fresh host-owned process.
    const authorized = await run(
      binary,
      args,
      profile(binary, [...readRoots, path.join(root, "agent-b")], writeRoots),
    );
    check(
      "explicit command read scope works",
      JSON.parse(authorized.stdout.split("\n")[0]).readOtherAgent === 1,
    );
    // Revocation creates no reusable kernel grant: the next instance receives the reduced profile.
    const revoked = await run(
      binary,
      args,
      profile(binary, readRoots, writeRoots),
    );
    check(
      "recreated revoked instance rejects previous scope",
      JSON.parse(revoked.stdout.split("\n")[0]).readOtherAgent === 0,
    );
    for (const mode of ["cancel", "broker-disconnect"]) {
      const supervisor = fork(self, ["--supervisor"], {
        env: {},
        execArgv: [],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          supervisor.kill();
          reject(Error("Supervisor timeout"));
        }, 8000);
        supervisor.once("message", (m) => {
          clearTimeout(timer);
          resolve(m.pid);
        });
        supervisor.once("error", reject);
      });
      supervisor.send({
        type: "start",
        binary,
        cwd: root,
        profile: profile(binary, readRoots, writeRoots),
      });
      const pid = await ready;
      const exited = new Promise((resolve) => supervisor.once("exit", resolve));
      if (mode === "cancel") supervisor.send({ type: "stop" });
      else supervisor.disconnect();
      await exited;
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      check(`${mode} waits for TERM-resistant process cleanup`, !alive);
    }
    const report = {
      platform: process.platform,
      arch: process.arch,
      os: spawnSync("sw_vers", ["-productVersion"], {
        encoding: "utf8",
      }).stdout.trim(),
      node: process.version,
      boundary: "default-deny-seatbelt; no direct fork; broker-owned commands",
      checks,
      count: checks.length,
      passed: true,
      limits: [
        "Prototype only; desktop wiring follows in stage 3",
        "Deprecated OS facility: absent/failed probes must refuse execution",
        "No unmediated process trees or direct networking supported",
        "No evidence for other OS/architectures/releases",
      ],
    };
    const out = process.argv.indexOf("--out");
    if (out !== -1)
      await writeFile(
        process.argv[out + 1],
        JSON.stringify(report, null, 2) + "\n",
      );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await heldDescriptor?.close();
    process.off("SIGUSR2", signalObserver);
    if (previousMarker === undefined) delete process.env.PLUMS_FIXTURE_SECRET;
    else process.env.PLUMS_FIXTURE_SECRET = previousMarker;
    await Promise.all(
      [tcp, unix]
        .filter(Boolean)
        .map((s) => new Promise((resolve) => s.close(resolve))),
    );
    await rm(root, { recursive: true, force: true });
  }
}
