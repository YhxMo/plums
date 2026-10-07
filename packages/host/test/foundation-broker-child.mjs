import { startFoundationSession } from "../dist/index.js";
process.on("message", async (m) => {
  if (m === "exit") process.exit(0);
  const session = await startFoundationSession({
    nodePath: m.nodePath,
    provider: {
      archive: Buffer.from(m.provider, "base64"),
      selection: m.selection,
    },
    component: {
      archive: Buffer.from(m.component, "base64"),
      agentId: "agent-a",
      installationId: "install-a",
    },
    requirement: m.requirement,
    bridge: async () => null,
    assertActive: async () => {},
    callTimeoutMs: 20000,
  });
  await session.ready();
  await session.activate();
  void session
    .invoke(
      "commands",
      "check",
      {},
      {
        callers: [],
        ancestry: ["consumer"],
        signal: new AbortController().signal,
      },
    )
    .catch(() => {});
  setTimeout(() => process.send({ pid: session.pid }), 100);
});
