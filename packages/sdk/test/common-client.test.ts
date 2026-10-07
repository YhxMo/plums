import { it, expect } from "vitest";
import { createCommonPlatformSdk } from "../src/common-client.js";
import type { CommonTaskSnapshot } from "../src/common-contract.js";
it("unsubscribing suppresses a pending state response without cancelling the shared task", async () => {
  let release!: (s: CommonTaskSnapshot) => void;
  const waiting = new Promise<CommonTaskSnapshot>((r) => (release = r)),
    methods: string[] = [];
  const sdk = createCommonPlatformSdk(
    async (method) => {
      methods.push(method);
      return waiting;
    },
    {
      list: async () => [],
      read: async () => ({ exists: false, revision: "0" }),
      write: async () => ({ revision: "0" }),
      delete: async () => ({ revision: "0" }),
    },
  );
  const values: CommonTaskSnapshot[] = [];
  const off = sdk.tasks.subscribe("fixture", (s) => values.push(s));
  off();
  release({
    status: {
      taskId: "fixture",
      state: "running",
      executionState: "unknown",
      lastSequence: 0,
    },
  });
  await waiting;
  await Promise.resolve();
  expect(values).toEqual([]);
  expect(methods).toEqual(["status"]);
});
