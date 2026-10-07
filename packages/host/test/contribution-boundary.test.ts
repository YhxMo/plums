import { expect, it } from "vitest";
import { ExtensionRuntime } from "../src/runtime.js";
it("enforces both schemas through the real runtime, snapshots input, and reports completed invalid output", async () => {
  let calls = 0;
  const runtime = new ExtensionRuntime(
    "fixture",
    {
      sdkVersion: "2",
      runtime: "main.js",
      contributes: {
        tools: [
          {
            name: "save",
            title: "Save",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
              additionalProperties: false,
            },
            outputSchema: {
              type: "object",
              properties: { stored: { const: true } },
              required: ["stored"],
              additionalProperties: false,
            },
          },
        ],
      },
    },
    async () => {
      calls++;
      return { done: true };
    },
    {
      "main.js": `export function activate(s){s.register('tools','save',async x=>{await s.capability('data',{kind:'fs',operation:'write',path:'x',data:[1]});return {text:x.text};});}`,
    },
  );
  const context = {
    callers: [],
    ancestry: ["fixture"],
    signal: new AbortController().signal,
  };
  try {
    await runtime.ready();
    await expect(
      runtime.invoke("tools", "save", { secret: "rejected" }, context),
    ).rejects.toMatchObject({ details: { executionState: "not_started" } });
    expect(calls).toBe(0);
    await expect(
      runtime.invoke("tools", "save", { text: "fixture" }, context),
    ).rejects.toMatchObject({
      details: {
        executionState: "completed",
        reason: "CONTRIBUTION_OUTPUT_INVALID",
      },
    });
    expect(calls).toBe(1);
  } finally {
    runtime.stop();
  }
});
