import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  VERSION,
  createCore,
  FakeModelProvider,
  MemorySecretStore,
  RecordingEgressSink,
  ScriptedConfirm,
} from "@plums/core";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("createCore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs with the bundled fakes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled"));
    const dataDir = mkdtempSync(path.join(tmpdir(), "plums-"));
    const model = new FakeModelProvider({ text: "hello" });
    const egress = new RecordingEgressSink();
    const confirm = new ScriptedConfirm([true]);
    const secrets = new MemorySecretStore();

    const core = createCore({ dataDir, model, egress, confirm, secrets });

    expect(core.version).toBe(VERSION);
    expect(core.dataDir).toBe(path.resolve(dataDir));
    expect(core).not.toHaveProperty("model");
    expect(core).not.toHaveProperty("egress");
    expect(core).not.toHaveProperty("confirm");
    expect(core).not.toHaveProperty("secrets");

    await expect(model.complete({ prompt: "hi" })).resolves.toEqual({ text: "hello" });
    expect(model.calls).toEqual([{ prompt: "hi" }]);

    await expect(confirm.ask({ message: "send the file?" })).resolves.toBe(true);
    await expect(confirm.ask({ message: "send again?" })).resolves.toBe(false);
    expect(confirm.asked.map((asked) => asked.message)).toEqual(["send the file?", "send again?"]);

    const request = { url: "https://example.test/share", method: "GET", body: "payload" };
    await expect(egress.send(request)).resolves.toEqual({ status: 200, body: "" });
    expect(egress.records).toEqual([request]);
    request.body = "changed";
    expect(egress.records[0]?.body).toBe("payload");
    expect(fetchSpy).not.toHaveBeenCalled();

    await secrets.set("pkg/token", "s3cret");
    await expect(secrets.get("pkg/token")).resolves.toBe("s3cret");
    await secrets.delete("pkg/token");
    await expect(secrets.get("pkg/token")).resolves.toBeUndefined();
    await expect(secrets.get("missing")).resolves.toBeUndefined();
  });

  it("denies confirmation when no answer was preset", async () => {
    const confirm = new ScriptedConfirm();
    await expect(confirm.ask({ message: "write?" })).resolves.toBe(false);
  });

  it("rejects a blank dataDir or a missing collaborator", () => {
    const options = {
      dataDir: "/tmp/plums-data",
      model: new FakeModelProvider(),
      egress: new RecordingEgressSink(),
      confirm: new ScriptedConfirm(),
      secrets: new MemorySecretStore(),
    };
    expect(() => createCore({ ...options, dataDir: "  " })).toThrow(TypeError);
    const withoutConfirm = createCore({ ...options, confirm: undefined });
    withoutConfirm.close();
    expect(() => createCore({ ...options, confirm: {} as never })).toThrow(/confirm/);
  });

  it("publishes the same version as the package", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });
});
