import { afterEach, expect, it } from "vitest";
import { rmSync } from "node:fs";
import {
  ScriptedConfirm,
  SinkFailure,
  type AuditEvent,
  type Core,
} from "@plumsjs/core";
import { makeCore, manifestZip, validManifestV2 } from "./package-helpers.js";
const worlds: { core: Core; dataDir: string }[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) {
    world.core.close();
    rmSync(world.dataDir, { recursive: true, force: true });
  }
});
it.each([
  [
    new SinkFailure("DNS_RESERVED_ADDRESS"),
    "not_started",
    "DNS_RESERVED_ADDRESS",
  ],
  [new SinkFailure("HTTP_REJECTED", 401), "completed", "HTTP_REJECTED"],
  [new Error("fake-secret transport details"), "unknown", "SINK_FAILED"],
  [
    Object.assign(Object.create(SinkFailure.prototype), {
      message: "fake-secret transport details",
      reason: "DNS_FAILED",
      executionState: "not_started",
    }),
    "unknown",
    "SINK_FAILED",
  ],
])(
  "reports known sink outcomes and keeps ordinary failures uncertain",
  async (error, state, reason) => {
    const events: Readonly<AuditEvent>[] = [];
    let sent = 0;
    const world = makeCore({
      confirm: new ScriptedConfirm([true]),
      egress: {
        async send() {
          sent++;
          throw error;
        },
      },
      onAudit: (event) => {
        events.push(event);
      },
    });
    worlds.push(world);
    const manifest = validManifestV2();
    await world.core.importPackage(await manifestZip(manifest));
    await world.core.grantConsent(manifest.id);
    await world.core.enable(manifest.id);
    let failure: any;
    try {
      await world.core.runCapability({
        extensionId: manifest.id,
        permissionId: "send",
        request: {
          kind: "egress",
          url: "https://api.example.com",
          method: "POST",
          body: "fake-private-body",
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(sent).toBe(1);
    expect(failure).toMatchObject({
      code: "CAPABILITY_FAILED",
      details: { phase: "sink", executionState: state },
    });
    expect(events.at(-1)).toMatchObject({
      phase: "result",
      outcome: "failed",
      executionState: state,
      reason,
      callId: failure.details.callId,
    });
    if (SinkFailure.describe(error))
      expect(failure.details).toMatchObject({
        reason: error.reason,
        ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}),
      });
    expect(JSON.stringify([failure, events])).not.toContain(
      "fake-private-body",
    );
    expect(JSON.stringify([failure, events])).not.toContain(
      "fake-secret transport details",
    );
  },
);
