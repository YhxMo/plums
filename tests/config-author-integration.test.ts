import { describe, expect, it } from "vitest";
import { Host } from "../modules/extension-host/host";
import type { Configuration, ExtensionContext, Platform } from "../modules/sdk";
import labelMaker from "./fixtures/author-label-maker.mjs";

const alpha = "author.labels-alpha";
const beta = "author.labels-beta";
const saved = (prefix = "A:", limit = 3, uppercase = true): Configuration => ({
  version: 1,
  values: { prefix, limit, uppercase },
});
const invalid: Array<[string, Configuration]> = [
  [
    "unknown field",
    { version: 1, values: { ...saved().values, surprise: true } },
  ],
  ["missing field", { version: 1, values: { prefix: "A:", limit: 3 } }],
  [
    "wrong primitive",
    { version: 1, values: { ...saved().values, limit: "3" } },
  ],
  ["number out of bounds", saved("A:", 41)],
  ["nonfinite number", saved("A:", NaN)],
  ["string too long", saved("abcdefghijklmnop")],
  ["unknown version", { ...saved(), version: 2 }],
];

function fixture() {
  const platform: Platform = {
    kind: "browser",
    available: () => false,
    async grant() {},
    async call() {
      throw Error("No platform capability is permitted in this probe");
    },
  };
  const host = new Host(platform);
  let bus: ExtensionContext | undefined;
  const responses: Record<string, unknown[]> = { [alpha]: [], [beta]: [] };
  host.install({
    manifest: { id: "author.labels-probe", version: "1", apiVersion: 1 },
    activate(ctx) {
      bus = ctx;
      for (const id of [alpha, beta])
        ctx.on(`${id}.response`, (data) => responses[id].push(data));
      ctx.onDispose(() => {
        bus = undefined;
      });
    },
  });
  return {
    host,
    responses,
    async open() {
      await host.start("author.labels-probe");
    },
    install(id: string, configuration?: Configuration) {
      host.install(
        { ...labelMaker, manifest: { ...labelMaker.manifest, id } },
        configuration,
      );
    },
    request(id: string, input = "plum blossom") {
      bus!.emit(`${id}.request`, input);
    },
    async close() {
      for (const id of host.ids().reverse()) await host.stop(id);
    },
  };
}

describe("independent configuration author integration", () => {
  it("uses defaults, changes actual output and keeps two instance IDs separate", async () => {
    const f = fixture();
    try {
      await f.open();
      f.install(alpha);
      f.install(beta, saved("B-", 5, false));
      await f.host.start(alpha);
      await f.host.start(beta);
      f.request(alpha);
      f.request(beta);
      expect(f.responses[alpha]).toEqual(["#plum blo"]);
      expect(f.responses[beta]).toEqual(["B-plum "]);

      await f.host.stop(alpha);
      await f.host.configure(alpha, saved());
      await f.host.start(alpha);
      f.request(alpha);
      f.request(beta);
      expect(f.responses[alpha]).toEqual(["#plum blo", "A:PLU"]);
      expect(f.responses[beta]).toEqual(["B-plum ", "B-plum "]);
      expect(f.host.configuration(alpha).value).toEqual(saved());
      expect(f.host.configuration(beta).value).toEqual(saved("B-", 5, false));
    } finally {
      await f.close();
    }
  });

  it.each(invalid)(
    "blocks activation of a saved configuration with %s",
    async (_name, bad) => {
      const f = fixture();
      try {
        await f.open();
        f.install(alpha, bad);
        expect(f.host.configuration(alpha).error).toBeTruthy();
        await f.host.start(alpha);
        expect(f.host.inspect(alpha).status).not.toBe("active");
        expect(f.host.inspect(alpha).resources).toBe(0);
        f.request(alpha);
        expect(f.responses[alpha]).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

  it.each(invalid)(
    "rejects a stopped-instance update with %s without replacing valid configuration",
    async (_name, bad) => {
      const f = fixture();
      try {
        await f.open();
        f.install(alpha, saved());
        await expect(f.host.configure(alpha, bad)).rejects.toThrow();
        expect(f.host.configuration(alpha).value).toEqual(saved());
        await f.host.start(alpha);
        f.request(alpha);
        expect(f.responses[alpha]).toEqual(["A:PLU"]);
      } finally {
        await f.close();
      }
    },
  );
});
