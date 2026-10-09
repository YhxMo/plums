// Deterministic outputs only; no review algorithm, model, network or grant API.
export function activate(sdk) {
  sdk.register("tools", "assess", async ({ input: c }) => {
    const setting = await sdk.settings();
    const decision =
      c.category === "local" ? (setting.localDecision ?? "allow") : "allow";
    if (decision === "invalid") return { decision };
    return {
      assessmentId: c.assessmentId,
      operationFingerprint: c.operationFingerprint,
      decision,
    };
  });
}
