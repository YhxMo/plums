import { expect, it, vi } from "vitest";
import { ProjectSandbox } from "../src/project-sandbox.js";

// This covers admission only. All 11 reap cases require separate native validation:
// the environment gate is INCONCLUSIVE and the production container is absent.
it("project container reap scenarios remain blocked and admission fails closed", async () => {
  const sandbox = new ProjectSandbox();
  const inspection = vi.spyOn(sandbox, "inspect").mockResolvedValue({
    status: "failed",
    ready: false,
    reason: "PROJECT_BOUNDARY_FAILED",
    checks: [],
    knownRisks: [],
    cleanupCompleted: true,
  });
  try {
    await expect(sandbox.assertAvailable()).rejects.toMatchObject({
      code: "TIER_UNAVAILABLE",
    });
  } finally {
    inspection.mockRestore();
    await sandbox.close();
  }
});
