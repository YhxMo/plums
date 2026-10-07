import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fixture } from "./common-fixture.js";
import { addPolicy, select, grant } from "./policy-fixture.js";
import { DesktopHost } from "../src/host.js";
const hosts: DesktopHost[] = [],
  dirs: string[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
it.runIf(process.platform === "darwin")(
  "actual controlled command honors allow and deny and cannot inherit an unselected directory operation",
  async () => {
    const f = await fixture(
      "controlled-node",
      `export function activate(s){s.register('tools','test',v=>s.capability('run',{kind:'exec',args:v.input.args,cwd:{root:'work',path:'.'}}));}`,
      [
        {
          id: "run",
          kind: "exec",
          target: "echo",
          cwdRoots: ["work"],
          reason: "Fixture command",
        },
        {
          id: "read",
          kind: "fs",
          target: "work",
          operations: ["read"],
          reason: "Fixture read",
        },
      ],
    );
    hosts.push(f.host);
    dirs.push(f.dir);
    const work = await mkdtemp(path.join(os.tmpdir(), "plums-policy-exec-"));
    dirs.push(work);
    await f.host.bindRoot(f.a.instanceId, "work", work);
    await f.host.bindControlledProgram(
      f.a.instanceId,
      "echo",
      "/bin/echo",
      ["work"],
      [],
    );
    for (const policy of ["allow", "deny"])
      await addPolicy(f.host, f.a.instanceId, policy);
    const run = () =>
      f.host.invoke(f.a.instanceId, "consumer", "consumer", "commands", "run", {
        args: ["policy-literal"],
      }) as Promise<any>;
    await select(f.host, f.a.instanceId, "allow");
    await grant(f.host, f.a.instanceId, (row) => row.category !== "fs");
    expect((await run()).outcome.error.code).toBe("NOT_AUTHORIZED");
    await f.host.revokePolicyScope(f.a.instanceId);
    await grant(f.host, f.a.instanceId);
    const allowed = await run();
    expect(allowed.outcome).toMatchObject({
      ok: true,
      value: {
        kind: "exec",
        result: { exitCode: 0, stdout: "policy-literal\n" },
      },
    });
    await select(f.host, f.a.instanceId, "deny");
    await grant(f.host, f.a.instanceId);
    expect((await run()).outcome.error.code).toBe("NOT_AUTHORIZED");
    expect(JSON.stringify(f.audit)).not.toContain("policy-literal");
  },
  20000,
);
it("HTTPS egress policy refuses before transport and allows only the real chain maximum", async () => {
  const f = await fixture(
    "isolate",
    `export function activate(s){s.register('tools','test',v=>s.capability('net',{kind:'egress',url:'https://example.com/fixture',method:'POST',headers:{Authorization:'never-in-intent'},body:'fixture-body'}));}`,
    [
      {
        id: "net",
        kind: "egress",
        target: "example.com",
        reason: "Fixture egress",
      },
    ],
  );
  hosts.push(f.host);
  dirs.push(f.dir);
  let sent = 0;
  f.options.egress = {
    send: async () => {
      sent++;
      return { status: 200, body: "fixture-response" };
    },
  } as any;
  // A new session captures the injected transport; no real external request is made.
  await f.host.stopSession(f.a.instanceId);
  await addPolicy(
    f.host,
    f.a.instanceId,
    "allow",
    `if(JSON.stringify(c.intent).includes('never-in-intent'))throw Error();return decision('allow');`,
  );
  await addPolicy(f.host, f.a.instanceId, "deny");
  const run = () =>
    f.host.invoke(
      f.a.instanceId,
      "consumer",
      "consumer",
      "commands",
      "run",
      null,
    ) as Promise<any>;
  await select(f.host, f.a.instanceId, "deny");
  await grant(f.host, f.a.instanceId);
  expect((await run()).outcome.ok).toBe(false);
  expect(sent).toBe(0);
  await select(f.host, f.a.instanceId, "allow");
  await grant(
    f.host,
    f.a.instanceId,
    (row) => row.componentId !== "consumer" || row.category !== "https",
  );
  expect((await run()).outcome.error.code).toBe("NOT_AUTHORIZED");
  expect(sent).toBe(0);
  await f.host.revokePolicyScope(f.a.instanceId);
  await grant(f.host, f.a.instanceId);
  expect((await run()).outcome.ok).toBe(true);
  expect(sent).toBe(1);
  expect(JSON.stringify(f.audit)).not.toContain("never-in-intent");
  expect(JSON.stringify(f.audit)).not.toContain("fixture-body");
});
it("a strategy can distinguish identical relative paths by the host-supplied logical target", async () => {
  const f = await fixture(
    "isolate",
    `export function activate(s){s.register('tools','test',v=>s.capability(v.input.permissionId,{kind:'fs',operation:'read',path:'same.txt'}));}`,
    [
      {
        id: "private-file",
        kind: "fs",
        target: "agent-data",
        operations: ["read"],
        reason: "Fixture private file",
      },
      {
        id: "work-file",
        kind: "fs",
        target: "work",
        operations: ["read"],
        reason: "Fixture work file",
      },
    ],
  );
  hosts.push(f.host);
  dirs.push(f.dir);
  const { mkdir, writeFile } = await import("node:fs/promises"),
    work = await mkdtemp(path.join(os.tmpdir(), "plums-policy-target-"));
  dirs.push(work);
  const privateRoot = path.join(
    f.dir,
    "instances",
    f.a.instanceId,
    "agent-data",
  );
  await mkdir(privateRoot, { recursive: true });
  await writeFile(path.join(privateRoot, "same.txt"), "private-fixture");
  await writeFile(path.join(work, "same.txt"), "external-fixture");
  await f.host.bindRoot(f.a.instanceId, "work", work);
  await addPolicy(
    f.host,
    f.a.instanceId,
    "target",
    `if(c.category==='tool')return decision('allow');if(c.permissionId!=='private-file'&&c.permissionId!=='work-file')throw Error();return decision(c.target==='agent-data'?'allow':'deny');`,
  );
  await select(f.host, f.a.instanceId, "target");
  await grant(f.host, f.a.instanceId);
  const run = (permissionId: string) =>
    f.host.invoke(f.a.instanceId, "consumer", "consumer", "commands", "run", {
      permissionId,
    }) as Promise<any>;
  expect((await run("private-file")).outcome).toMatchObject({
    ok: true,
    value: { kind: "fs", data: [...Buffer.from("private-fixture")] },
  });
  expect((await run("work-file")).outcome.error.code).toBe("NOT_AUTHORIZED");
});
