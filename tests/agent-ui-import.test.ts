import { expect, it } from "vitest";

it("loads the Agent extension without evaluating browser media queries at module scope", async () => {
  expect(typeof globalThis.matchMedia).toBe("undefined");
  await expect(import("../src/agent-ui")).resolves.toMatchObject({
    agentUI: expect.any(Function),
  });
});
