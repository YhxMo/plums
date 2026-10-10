import type { Confirm, ConfirmRequest, Permission } from "@plumsjs/core";
import { describe, expect, it } from "vitest";
import {
  editConsent,
  editManifest,
  fixtureManifest,
  fixturePath,
  install,
  snapshot,
  useWorlds,
  type World,
} from "./contract-helpers.js";
import { expectPlumsError, manifestZip } from "./package-helpers.js";

const world = useWorlds();
const YES = [true, true, true, true, true, true, true, true];

const EXACT = "valid/egress-target-exact.zip";
const PORT = "valid/egress-target-port.zip";
const WILD = "valid/egress-target-wildcard.zip";
const THREE = "valid/extension-3-levels.zip";

describe("T4: enable, dependencies, reimport, listInstalled", () => {
  it("a missing dependency is DEPENDENCY_MISSING at /dependencies/<i>", async () => {
    const w = world();
    const id = await install(w, "invalid/dependency-missing.zip", {
      consent: true,
    });
    const err = await expectPlumsError(
      w.core.enable(id),
      "DEPENDENCY_MISSING",
      "/dependencies/0",
    );
    expect(err.details).toMatchObject({ id });
    expect(await w.core.listInstalled()).toMatchObject([
      { id, enabled: false },
    ]);
  });

  it("an unmet version range is DEPENDENCY_MISSING at the index of that dependency", async () => {
    const w = world();
    await install(w, "valid/extension-min.zip");
    const manifest = await fixtureManifest(w, "valid/extension-with-dep.zip");
    const ok = manifest.dependencies[0]!;
    const manifest2 = {
      ...manifest,
      id: "test.ext.dep2",
      dependencies: [ok, { ...ok, range: "^2.0.0" }],
    };
    await w.core.importPackage(await manifestZip(manifest2));
    await w.core.grantConsent("test.ext.dep2");
    await expectPlumsError(
      w.core.enable("test.ext.dep2"),
      "DEPENDENCY_MISSING",
      "/dependencies/1",
    );
  });

  it("an optional dependency does not block enable, a satisfied one lets it through", async () => {
    const w = world();
    const manifest = await fixtureManifest(w, "invalid/dependency-missing.zip");
    const optional = {
      ...manifest,
      dependencies: [{ ...manifest.dependencies[0]!, optional: true }],
    };
    await w.core.importPackage(await manifestZip(optional));
    await w.core.grantConsent(manifest.id);
    expect(await w.core.enable(manifest.id)).toMatchObject({ enabled: true });

    await install(w, "valid/extension-min.zip");
    const dep = await install(w, "valid/extension-with-dep.zip", {
      enable: true,
    });
    expect(await w.core.listInstalled()).toContainEqual(
      expect.objectContaining({ id: dep, enabled: true }),
    );
  });

  const methods: [string, (w: World) => Promise<unknown>][] = [
    ["grantConsent", (w) => w.core.grantConsent("nope")],
    ["getConsent", (w) => w.core.getConsent("nope")],
    ["enable", (w) => w.core.enable("nope")],
    ["disable", (w) => w.core.disable("nope")],
    ["uninstall", (w) => w.core.uninstall("nope")],
    [
      "runAction",
      (w) => w.core.runAction({ extensionId: "nope", permissionId: "p" }),
    ],
  ];
  it.each(methods)(
    "%s on an id that is not installed: PERMISSION_DENIED / NOT_INSTALLED",
    async (_name, call) => {
      const err = await expectPlumsError(call(world()), "PERMISSION_DENIED");
      expect(err.details).toEqual({ id: "nope", reason: "NOT_INSTALLED" });
    },
  );

  it("after uninstall the same id imports as a fresh package: not enabled, not consented", async () => {
    const w = world();
    const id = await install(w, THREE, { enable: true });
    await w.core.uninstall(id);
    expect(await w.core.listInstalled()).toEqual([]);
    await w.core.importPackage(fixturePath(THREE));
    expect(await w.core.listInstalled()).toMatchObject([
      { id, enabled: false, consented: false },
    ]);
    expect(await w.core.getConsent(id)).toBeNull();
    await expectPlumsError(w.core.enable(id), "CONSENT_REQUIRED");
    await w.core.grantConsent(id);
    expect(await w.core.enable(id)).toMatchObject({
      enabled: true,
      consented: true,
    });
  });

  it("listInstalled reports every installed package with its state", async () => {
    const w = world();
    expect(await w.core.listInstalled()).toEqual([]);
    await install(w, "valid/character-min.zip");
    await install(w, "valid/extension-min.zip", { enable: true });
    await install(w, "valid/connector-min.zip", { consent: true });
    const list = (await w.core.listInstalled()).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    expect(list).toMatchObject([
      {
        id: "test.char.min",
        kind: "character",
        version: "1.0.0",
        enabled: false,
        consented: false,
      },
      {
        id: "test.conn.min",
        kind: "connector",
        version: "1.0.0",
        enabled: false,
        consented: true,
      },
      {
        id: "test.ext.min",
        kind: "extension",
        version: "1.0.0",
        enabled: true,
        consented: true,
      },
    ]);
    await w.core.disable("test.ext.min");
    expect(await w.core.listInstalled()).toContainEqual(
      expect.objectContaining({ id: "test.ext.min", enabled: false }),
    );
  });
});

describe("T5: runAction check order", () => {
  it("not enabled is PERMISSION_DENIED, also after disable", async () => {
    const w = world({ answers: YES });
    const id = await install(w, THREE, { consent: true });
    await expectPlumsError(
      w.core.runAction({ extensionId: id, permissionId: "p.read" }),
      "PERMISSION_DENIED",
    );
    await w.core.enable(id);
    await w.core.runAction({ extensionId: id, permissionId: "p.read" });
    await w.core.disable(id);
    await expectPlumsError(
      w.core.runAction({ extensionId: id, permissionId: "p.read" }),
      "PERMISSION_DENIED",
    );
  });

  it.each([
    ["an unknown permission id", "p.nope"],
    ["a permission declared by another extension", "p.egress"],
  ])(
    "%s is PERMISSION_DENIED at /permissions, with no confirm and no send",
    async (_name, permissionId) => {
      const w = world({ answers: YES });
      await install(w, THREE, { enable: true });
      const readOnly = await install(
        w,
        "malicious/declares-read-wants-egress.zip",
        { enable: true },
      );
      const err = await expectPlumsError(
        w.core.runAction({
          extensionId: readOnly,
          permissionId,
          request: { url: "https://example.com/steal" },
        }),
        "PERMISSION_DENIED",
        "/permissions",
      );
      expect(err.details).toMatchObject({ id: readOnly, permissionId });
      expect([w.confirm.asked, w.egress.records]).toEqual([[], []]);
    },
  );

  it("a character card that claims permissions in its text has none", async () => {
    const w = world({ answers: YES });
    const id = await install(w, "malicious/card-claims-permissions.zip", {
      enable: true,
    });
    for (const permissionId of ["egress", "write", "p.egress"]) {
      await expectPlumsError(
        w.core.runAction({ extensionId: id, permissionId }),
        "PERMISSION_DENIED",
        "/permissions",
      );
    }
    expect([w.confirm.asked, w.egress.records]).toEqual([[], []]);
  });

  const stale: [string, number, (list: Permission[]) => Permission[] | null][] =
    [
      ["no consent record", 2, () => null],
      [
        "a consent without that permission",
        2,
        (l) => l.filter((p) => p.id !== "p.egress"),
      ],
      [
        "a consent for another id",
        2,
        (l) =>
          l.map((p) => (p.id === "p.egress" ? { ...p, id: "p.other" } : p)),
      ],
      [
        "a consent with a lower level",
        2,
        (l) =>
          l.map((p) => (p.id === "p.egress" ? { ...p, level: "read" } : p)),
      ],
      [
        "a consent for another target",
        2,
        (l) =>
          l.map((p) =>
            p.id === "p.egress" ? { ...p, target: "other.com" } : p,
          ),
      ],
      [
        "a consent for another target (read)",
        0,
        (l) =>
          l.map((p) => (p.id === "p.read" ? { ...p, target: "other" } : p)),
      ],
    ];
  it.each(stale)(
    "%s is CONSENT_REQUIRED at /permissions/<i>",
    async (_name, index, change) => {
      const w = world({ answers: YES });
      const id = await install(w, THREE, { enable: true });
      editConsent(w, id, change);
      const err = await expectPlumsError(
        w.core.runAction({
          extensionId: id,
          permissionId: ["p.read", "p.write", "p.egress"][index]!,
          request: { url: "https://example.com/x" },
        }),
        "CONSENT_REQUIRED",
        `/permissions/${index}`,
      );
      expect(err.details).toMatchObject({ id });
      expect([w.confirm.asked, w.egress.records]).toEqual([[], []]);
    },
  );
});

describe("T5: confirm", () => {
  const askers = [
    ["write", "p.write", undefined],
    ["egress", "p.egress", { url: "https://example.com/x" }],
  ] as const;

  it.each(askers)(
    "%s asks confirm on every run",
    async (level, permissionId, request) => {
      const w = world({ answers: [true, true, false] });
      const id = await install(w, THREE, { enable: true });
      const input = {
        extensionId: id,
        permissionId,
        ...(request ? { request } : {}),
      };
      expect(await w.core.runAction(input)).toMatchObject({ level });
      expect(await w.core.runAction(input)).toMatchObject({ level });
      expect(w.confirm.asked).toHaveLength(2);
      await expectPlumsError(w.core.runAction(input), "CONFIRMATION_DENIED");
      expect(w.confirm.asked).toHaveLength(3);
    },
  );

  const refusals: [string, () => Confirm][] = [
    ["no handler answers", () => ({ ask: () => undefined as never })],
    [
      "the handler throws",
      () => ({ ask: () => Promise.reject(new Error("boom")) }),
    ],
    [
      "the handler throws synchronously",
      () => ({
        ask: () => {
          throw new Error("boom");
        },
      }),
    ],
    ...([false, "true", "yes", 1, {}, null] as const).map(
      (answer) =>
        [
          `the answer is ${JSON.stringify(answer)}`,
          () => ({ ask: async () => answer as never }),
        ] as [string, () => Confirm],
    ),
  ];
  it("anything other than true is CONFIRMATION_DENIED for write and egress, and nothing is sent", async () => {
    for (const [, make] of refusals) {
      for (const [, permissionId, request] of askers) {
        const w = world({ confirm: make() });
        const id = await install(w, THREE, { enable: true });
        const err = await expectPlumsError(
          w.core.runAction({
            extensionId: id,
            permissionId,
            ...(request ? { request } : {}),
          }),
          "CONFIRMATION_DENIED",
        );
        expect(err.details).toEqual({ id, permissionId });
        expect(w.egress.records).toEqual([]);
      }
    }
  });

  it("an unscripted ScriptedConfirm denies", async () => {
    const w = world();
    const id = await install(w, THREE, { enable: true });
    await expectPlumsError(
      w.core.runAction({ extensionId: id, permissionId: "p.write" }),
      "CONFIRMATION_DENIED",
    );
  });

  it("read never asks and never sends; write is only let through", async () => {
    const w = world({ answers: YES });
    const id = await install(w, THREE, { enable: true });
    const request = { url: "https://example.com/x" };
    expect(
      await w.core.runAction({
        extensionId: id,
        permissionId: "p.read",
        request,
      }),
    ).toEqual({ level: "read" });
    expect(w.confirm.asked).toEqual([]);
    expect(
      await w.core.runAction({
        extensionId: id,
        permissionId: "p.write",
        request,
      }),
    ).toEqual({ level: "write" });
    expect(w.confirm.asked).toHaveLength(1);
    expect(w.egress.records).toEqual([]);
  });

  it("egress sends the request once, unchanged, and returns what the sink answered", async () => {
    const w = world({ answers: YES });
    const id = await install(w, THREE, { enable: true });
    const request = {
      url: "https://example.com/x?a=1",
      method: "POST",
      body: '{"k":1}',
    };
    const result = await w.core.runAction({
      extensionId: id,
      permissionId: "p.egress",
      request,
    });
    expect(result).toEqual({
      level: "egress",
      egress: { status: 200, body: "" },
    });
    expect(w.egress.records).toEqual([request]);
  });

  const asks: [string, string, string, string, Partial<ConfirmRequest>][] = [
    [
      "exact host",
      EXACT,
      "p.egress",
      "https://api.example.com/x",
      { host: "api.example.com", reason: "精确主机" },
    ],
    [
      "explicit port",
      PORT,
      "p.egress",
      "https://api.example.com:8443/x",
      { host: "api.example.com:8443", reason: "带端口" },
    ],
    [
      "wildcard",
      WILD,
      "p.egress",
      "https://a.b.example.com/x",
      { host: "a.b.example.com", reason: "通配主机" },
    ],
  ];
  it.each(asks)(
    "confirm.ask for egress carries host and reason: %s",
    async (_name, rel, permissionId, url, expected) => {
      const w = world({ answers: YES });
      const id = await install(w, rel, { enable: true });
      await w.core.runAction({
        extensionId: id,
        permissionId,
        request: { url },
      });
      expect(w.confirm.asked).toHaveLength(1);
      expect(w.confirm.asked[0]).toMatchObject(expected);
    },
  );

  it("confirm.ask for write carries the reason and no host", async () => {
    const w = world({ answers: YES });
    const id = await install(w, THREE, { enable: true });
    await w.core.runAction({ extensionId: id, permissionId: "p.write" });
    expect(w.confirm.asked[0]).toMatchObject({ reason: "写入笔记" });
    expect(w.confirm.asked[0]?.host).toBeUndefined();
  });

  it("a level or target that changes during confirm is PERMISSION_DENIED and the sink stays empty", async () => {
    const changes = [
      (list: Permission[]) =>
        list.map((p) =>
          p.level === "egress" ? { ...p, level: "read" as const } : p,
        ),
      (list: Permission[]) =>
        list.map((p) =>
          p.level === "egress" ? { ...p, target: "other.example.com" } : p,
        ),
    ];
    for (const change of changes) {
      let id = "";
      const w = world({
        confirm: {
          ask: () => {
            editManifest(w, id, (m) => ({
              ...m,
              permissions: change(m.permissions),
            }));
            editConsent(w, id, change);
            return Promise.resolve(true);
          },
        },
      });
      id = await install(w, EXACT, { enable: true });
      const err = await expectPlumsError(
        w.core.runAction({
          extensionId: id,
          permissionId: "p.egress",
          request: { url: "https://api.example.com/x" },
        }),
        "PERMISSION_DENIED",
        "/request/url",
      );
      expect(err.details).toMatchObject({
        id,
        permissionId: "p.egress",
        reason: "URL_NOT_ALLOWED",
      });
      expect(w.egress.records).toEqual([]);
    }
  });
});

describe("T5: egress targets", () => {
  const rules: [string, string, string[], string[]][] = [
    [
      "api.example.com",
      EXACT,
      [
        "https://api.example.com/x",
        "https://api.example.com",
        "https://api.example.com:443/x",
      ],
      [
        "https://evil.com",
        "https://api.example.com.evil.com",
        "http://api.example.com",
        "https://api.example.com:8443",
        "https://1.2.3.4",
        "https://user@api.example.com",
        "https://api.example.com@evil.com/",
        "https://evil.com/?u=https://api.example.com",
        "https://sub.api.example.com/x",
        "https://localhost/x",
        "https://a.localhost/x",
        "not a url",
      ],
    ],
    [
      "*.example.com",
      WILD,
      ["https://a.example.com/x", "https://a.b.example.com/x"],
      [
        "https://example.com/x",
        "https://evilexample.com/x",
        "https://a.example.com.evil.com/",
        "http://a.example.com/",
      ],
    ],
    [
      "api.example.com:8443",
      PORT,
      ["https://api.example.com:8443/x"],
      [
        "https://api.example.com/x",
        "https://api.example.com:443/x",
        "https://api.example.com:8444/x",
      ],
    ],
  ];
  it.each(rules)(
    "target %s allows its own urls and refuses the rest before confirm",
    async (_target, rel, ok, bad) => {
      const w = world({ answers: YES });
      const id = await install(w, rel, { enable: true });
      for (const url of ok) {
        w.confirm.asked.length = 0;
        w.egress.records.length = 0;
        expect(
          await w.core.runAction({
            extensionId: id,
            permissionId: "p.egress",
            request: { url },
          }),
        ).toMatchObject({
          level: "egress",
        });
        expect(w.confirm.asked).toHaveLength(1);
        expect(w.egress.records.map((r) => r.url)).toEqual([new URL(url).href]);
      }
      for (const url of bad) {
        w.confirm.asked.length = 0;
        w.egress.records.length = 0;
        await expectPlumsError(
          w.core.runAction({
            extensionId: id,
            permissionId: "p.egress",
            request: { url },
          }),
          "PERMISSION_DENIED",
          "/request/url",
        );
        expect([w.confirm.asked, w.egress.records]).toEqual([[], []]);
      }
    },
  );
});

describe("T5: the core does not follow redirects", () => {
  const START = "https://api.example.com/start";
  const targets = [
    "https://api.example.com/next",
    "/relative",
    "https://evil.com/x",
    "http://api.example.com/x",
    "https://api.example.com:8443/x",
  ];

  // Agreed rule: the core never follows a redirect.
  it("a redirect is handed back as it is, after exactly one send", async () => {
    for (const target of targets) {
      const w = world({
        answers: YES,
        redirects: { 1: target, 2: "https://api.example.com/second" },
      });
      const id = await install(w, EXACT, { enable: true });
      const result = await w.core.runAction({
        extensionId: id,
        permissionId: "p.egress",
        request: { url: START },
      });
      expect(result).toEqual({
        level: "egress",
        egress: { status: 302, body: "", redirectTo: target },
      });
      expect(w.egress.records.map((r) => r.url)).toEqual([START]);
      expect(w.confirm.asked).toHaveLength(1);
    }
  });
});

describe("T5: a package installed with an old-style egress target", () => {
  const legacy = [
    "https://api.example.com",
    "api.example.com/x",
    "1.2.3.4",
    "localhost",
    "*.localhost",
    "api.localhost",
    "",
  ];

  it("an old-style egress target is PERMISSION_DENIED, with no confirm and no send", async () => {
    for (const target of legacy) {
      const w = world({ answers: YES });
      const id = await install(w, EXACT);
      editManifest(w, id, (m) => ({
        ...m,
        permissions: m.permissions.map((p) => ({ ...p, target })),
      }));
      await w.core.grantConsent(id);
      await w.core.enable(id);
      const url = target.startsWith("https://")
        ? `${target}/x`
        : "https://api.example.com/x";
      await expectPlumsError(
        w.core.runAction({
          extensionId: id,
          permissionId: "p.egress",
          request: { url },
        }),
        "PERMISSION_DENIED",
      );
      expect([w.confirm.asked, w.egress.records]).toEqual([[], []]);
    }
  });
});

describe("T5: refusals leave state alone", () => {
  it("a denied run changes nothing", async () => {
    const w = world({ answers: [false] });
    const id = await install(w, THREE, { enable: true });
    const before = await snapshot(w);
    await expectPlumsError(
      w.core.runAction({ extensionId: id, permissionId: "p.write" }),
      "CONFIRMATION_DENIED",
    );
    expect(await snapshot(w)).toEqual(before);
  });
});
