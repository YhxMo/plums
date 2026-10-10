import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
  type EgressRequest,
  type EgressResult,
} from "@plumsjs/core";
import { desktopContribution, type FoundationSelection } from "@plumsjs/sdk";
import { DesktopHost, type HostOptions } from "../../src/host.js";
import type { protocolPlan } from "../../src/protocol-bindings.js";
import { cardFixture, packExtension } from "../fixtures/extensions/pack.js";
import { scenarioBinding, scenarioFoundation } from "./foundation-selection.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }[];
}
export interface ModelInput {
  messages: ChatMessage[];
  tools?: { name: string; description: string; inputSchema: object }[];
}
export const reply = (content: string) => ({
  message: { role: "assistant", content },
});
export const toolReply = (
  name: string,
  args: Record<string, unknown>,
  id = "test-call",
) => ({
  message: {
    role: "assistant",
    content: "",
    toolCalls: [{ id, name, arguments: args }],
  },
});
export class FakeModelSink extends RecordingEgressSink {
  readonly inputs: ModelInput[] = [];
  respond: (input: ModelInput, index: number) => unknown = () =>
    reply("Synthetic reply");
  transport: EgressResult | undefined;
  override async send(request: EgressRequest): Promise<EgressResult> {
    if (request.url !== "https://model.plums-fixture.test/complete")
      throw Error("Unexpected test destination");
    await super.send(request);
    const input = JSON.parse(request.body!) as ModelInput;
    this.inputs.push(input);
    return (
      this.transport ?? {
        status: 200,
        body: JSON.stringify(this.respond(input, this.inputs.length - 1)),
      }
    );
  }
}

export async function chatFixture(
  foundation?: FoundationSelection,
  egress = new FakeModelSink(),
  options: Partial<Pick<HostOptions, "confirm" | "audit">> = {},
) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "plums-scenario-chat-"),
  );
  const secrets = new MemorySecretStore();
  let host: DesktopHost;
  const open = () =>
    new DesktopHost({
      dataDir: directory,
      fs: new RecordingFsSink(),
      egress,
      secretStore: () => secrets,
      confirm: { ask: async () => true },
      ...options,
      ...(foundation ? { foundation } : {}),
    });
  host = open();
  await host.initialize();
  let selectedFoundation: FoundationSelection;
  const put = async (bytes: Uint8Array) => {
    const preview = (await host.preview(bytes)) as { token: string };
    const item = await host.importLibrary(preview.token);
    if (!("manifest" in item)) throw Error("Expected a component artifact");
    return item;
  };
  const artifacts = new Map<string, Awaited<ReturnType<typeof put>>>();
  try {
    selectedFoundation = await scenarioFoundation(host, foundation);
    for (const name of [
      "model-fake",
      "agent-loop",
      "memory",
      "card-parser",
      "card-parser-alt",
      "tavern",
      "mcp-bridge",
    ])
      artifacts.set(name, await put(await packExtension(name)));
    for (const name of ["v1", "v2", "v3", "non-card"])
      artifacts.set(name, await put(await cardFixture(name)));
  } catch (error) {
    await host.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const idOf = (name: string) => artifacts.get(name)!.manifest.id;
  const invoke = (
    agent: string,
    component: string,
    name: string,
    input: unknown,
  ) =>
    host.invoke(
      agent,
      idOf(component),
      idOf(component),
      component === "agent-loop" ? "commands" : "tools",
      name,
      input,
    );
  const grant = async (id: string) => {
    const plan = await host.resourcePlan(id);
    if (!plan.bindings.length) return;
    await host.grantResourceRange(
      id,
      plan.fingerprint,
      "task",
      900_000,
      plan.bindings.map((b) => ({
        componentId: b.componentId,
        resourceId: b.resourceId,
        operations: ["read", "write"],
      })),
    );
  };
  const create = async (
    names = ["model-fake", "agent-loop", "memory", "card-parser", "v2"],
    card = "v2",
  ) => {
    const record = await host.createAgent(
      "Synthetic chat scenario",
      names.map((name) => artifacts.get(name)!.digest),
      names.includes(card) ? idOf(card) : undefined,
      undefined,
      [],
      scenarioBinding(selectedFoundation),
    );
    await host.setSettings(
      record.instanceId,
      idOf("model-fake"),
      { baseURL: "https://model.plums-fixture.test" },
      { apiKey: "synthetic-scenario-credential" },
    );
    if (names.includes("mcp-bridge"))
      await host.setSettings(
        record.instanceId,
        idOf("mcp-bridge"),
        { baseURL: "https://mcp.plums-fixture.test" },
        {},
      );
    // Consumers can only be enabled after their selected providers.
    for (const name of [
      ...names.filter((name) => !["tavern", "agent-loop"].includes(name)),
      ...names.filter((name) => name === "tavern"),
      ...names.filter((name) => name === "agent-loop"),
    ])
      await host.enable(record.instanceId, idOf(name));
    const privateSpace = (
      await host.resourcePlan(record.instanceId)
    ).spaces.find((space) => space.ownerAgentId === record.instanceId)!;
    for (const component of [
      "",
      ...names
        .filter((name) => ["agent-loop", "memory"].includes(name))
        .map(idOf),
    ])
      await host.setResourceQualification(
        record.instanceId,
        (await host.resourcePlan(record.instanceId)).fingerprint,
        privateSpace.id,
        component,
        ["read", "write"],
      );
    for (const name of names) {
      const manifest = artifacts.get(name)!.manifest;
      for (const requirement of desktopContribution(manifest)?.common
        ?.resources ?? [])
        await host.setResourceBinding(
          record.instanceId,
          (await host.resourcePlan(record.instanceId)).fingerprint,
          manifest.id,
          requirement.id,
          privateSpace.id,
        );
    }
    await host.setStartup(record.instanceId, idOf("agent-loop"));
    await grant(record.instanceId);
    return record;
  };
  return {
    get host() {
      return host;
    },
    directory,
    egress,
    secrets,
    artifacts,
    put,
    idOf,
    create,
    grant,
    protocols: (agent: string) =>
      host.protocolPlan(agent) as Promise<
        Awaited<ReturnType<typeof protocolPlan>>
      >,
    chat: (agent: string, text: string) =>
      invoke(agent, "agent-loop", "chat", { text }),
    history: (agent: string) =>
      invoke(agent, "agent-loop", "history", {}) as Promise<ChatMessage[]>,
    memory: (agent: string, operation: "search" | "upsert", input: unknown) =>
      invoke(agent, "memory", "memory", { operation, input }),
    tools: (agent: string, operation: "list" | "call", input: unknown) =>
      invoke(agent, "memory", "tools", { operation, input }),
    context: (agent: string, messages: ChatMessage[]) =>
      invoke(agent, "tavern", "context", {
        operation: "context",
        input: { messages },
      }),
    restart: async () => {
      await host.close();
      host = open();
      await host.initialize();
    },
    close: async () => {
      await host.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
