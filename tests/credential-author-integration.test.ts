import { describe, expect, it } from "vitest";
import { Host } from "../modules/extension-host/host";
import { FakeCredentialPlatform } from "./fixtures/credential-platform";
import { createTranslator } from "./fixtures/author-translator.mjs";

type Translator = { translate(text: string): Promise<string> };
const alice = "author.translate-alice";
const bob = "author.translate-bob";
const unbound = "author.translate-unbound";

function fixture() {
  const dispatched: Array<{ target: string; body: string }> = [];
  const platform = new FakeCredentialPlatform(
    [
      {
        owner: `extension.${alice}`,
        id: "translate",
        target: "https://alice.invalid/translate",
      },
      {
        owner: `extension.${bob}`,
        id: "translate",
        target: "https://bob.invalid/translate",
      },
    ],
    async ({ target, body }) => {
      dispatched.push({ target, body });
      const input = JSON.parse(body) as { text: string };
      const language =
        target === "https://alice.invalid/translate" ? "FR" : "DE";
      return {
        status: 200,
        body: JSON.stringify({ translated: `${language}:${input.text}` }),
      };
    },
  );
  const host = new Host(platform);
  const clients = new Map<string, Translator>();
  for (const id of [alice, bob, unbound]) {
    host.install(createTranslator(id));
    host.install({
      manifest: {
        id: `${id}.reader`,
        version: "1",
        apiVersion: 1,
        requires: { [`${id}.translator`]: 1 },
      },
      activate(ctx) {
        clients.set(id, ctx.use<Translator>(`${id}.translator`));
        ctx.onDispose(() => {
          clients.delete(id);
        });
      },
    });
  }
  return {
    host,
    clients,
    dispatched,
    async enable(id: string) {
      await host.grant(id, ["credential.request"]);
      await host.start(id);
      await host.start(`${id}.reader`);
    },
    async close() {
      for (const id of host.ids().reverse()) await host.stop(id);
    },
  };
}

describe("independent credential connector author", () => {
  it("parses synthetic responses and resolves the same binding separately for each owner", async () => {
    const f = fixture();
    try {
      await f.enable(alice);
      await f.enable(bob);
      expect(await f.clients.get(alice)!.translate("plum")).toBe("FR:plum");
      expect(await f.clients.get(bob)!.translate("plum")).toBe("DE:plum");
      expect(f.dispatched).toEqual([
        { target: "https://alice.invalid/translate", body: '{"text":"plum"}' },
        { target: "https://bob.invalid/translate", body: '{"text":"plum"}' },
      ]);
      await f.enable(unbound);
      await expect(
        f.clients.get(unbound)!.translate("plum"),
      ).rejects.toMatchObject({ outcome: "not-dispatched" });
      expect(f.dispatched).toHaveLength(2);
    } finally {
      await f.close();
    }
  });

  it("does not activate or dispatch an unauthorized connector", async () => {
    const f = fixture();
    try {
      await f.host.start(alice);
      await f.host.start(`${alice}.reader`);
      expect(f.host.inspect(alice).status).not.toBe("active");
      expect(f.host.serviceNames()).not.toContain(`${alice}.translator`);
      expect(f.clients.has(alice)).toBe(false);
      expect(f.dispatched).toEqual([]);
      await f.enable(alice);
      expect(await f.clients.get(alice)!.translate("authorized")).toBe(
        "FR:authorized",
      );
    } finally {
      await f.close();
    }
  });

  it("rejects retained service calls after stop and after capability revocation", async () => {
    const f = fixture();
    try {
      await f.enable(alice);
      const stopped = f.clients.get(alice)!;
      await f.host.stop(alice);
      await expect(stopped.translate("after-stop")).rejects.toMatchObject({
        outcome: "not-committed",
      });
      expect(f.host.serviceNames()).not.toContain(`${alice}.translator`);
      expect(f.dispatched).toEqual([]);
      await f.enable(alice);
      const revoked = f.clients.get(alice)!;
      await f.host.grant(alice, []);
      await expect(revoked.translate("after-revoke")).rejects.toMatchObject({
        outcome: "not-committed",
      });
      expect(f.host.inspect(alice).status).not.toBe("active");
      expect(f.dispatched).toEqual([]);
    } finally {
      await f.close();
    }
  });
});
