import { afterEach, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createArchive,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
  type ManifestV2,
} from "@plums/core";
import { desktopContribution, type FoundationSelection } from "@plums/sdk";
import { scenarioBinding, scenarioFoundation } from "./foundation-selection.js";
import type { protocolPlan } from "../../src/protocol-bindings.js";
import { DesktopHost } from "../../src/host.js";
import {
  cardFixture,
  cardPng,
  fixtureManifest,
  fixturesDirectory,
  packExtension,
} from "../fixtures/extensions/pack.js";

const hosts: DesktopHost[] = [],
  directories: string[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const parsers = ["card-parser", "card-parser-alt"];
const unrecognized = { error: { code: "CARD_UNRECOGNIZED" } };
const expectedV1 = {
  source: "v1",
  name: "Harbor guide",
  description: "I am a synthetic harbor guide.",
  personality: "Patient and precise.",
  scenario: "A fictional test harbor.",
  firstMessage: "Welcome to the fixture harbor.",
  exampleMessages: "User: Where?\nGuide: Here.",
  systemPrompt: "",
  postHistoryInstructions: "",
  alternateGreetings: [],
  tags: [],
  creator: "",
  characterVersion: "",
  creatorNotes: "",
  extensions: { "fixture/v1": { opaque: true } },
};
const expectedV2 = {
  ...expectedV1,
  source: "v2",
  systemPrompt: "Keep fixture replies brief.",
  postHistoryInstructions: "Remember the test harbor.",
  alternateGreetings: ["Fixture hello.", "Fixture welcome."],
  tags: ["synthetic", "assistant"],
  creator: "Plums tests",
  characterVersion: "fixture-2",
  creatorNotes: "Invented solely for tests.",
  extensions: { "fixture/unknown": { nested: ["keep", 7], enabled: true } },
  characterBook: {
    name: "Synthetic harbor book",
    scanDepth: 3,
    extensions: { "fixture/book": { opaque: true } },
    entries: [
      {
        keys: ["lighthouse"],
        secondaryKeys: ["night"],
        content: "The test lighthouse flashes blue.",
        enabled: true,
        insertionOrder: 20,
        caseSensitive: true,
        constant: false,
        selective: true,
        position: "after_char",
        extensions: { "fixture/entry": { keep: "yes" } },
      },
      {
        keys: [],
        secondaryKeys: [],
        content: "The test harbor is fictional.",
        enabled: true,
        insertionOrder: 10,
        caseSensitive: false,
        constant: true,
        selective: false,
        position: "before_char",
        extensions: {},
      },
      {
        keys: ["disabled"],
        secondaryKeys: [],
        content: "This test entry is disabled.",
        enabled: false,
        insertionOrder: 0,
        caseSensitive: false,
        constant: false,
        selective: false,
        position: "before_char",
        extensions: {},
      },
    ],
  },
};
const expectedV3 = {
  ...expectedV2,
  source: "v3",
  name: "Synthetic tutor",
  description: "I am a synthetic private tutor.",
  tags: ["synthetic", "tutor"],
  characterVersion: "fixture-3",
  extensions: { "fixture/v3": { preserve: [null, { value: "opaque" }] } },
  characterBook: {
    ...expectedV2.characterBook,
    entries: expectedV2.characterBook.entries.map((entry) => ({
      ...entry,
      useRegex: false,
    })),
  },
};

async function fixture(
  parserNames = parsers,
  foundation?: FoundationSelection,
) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "plums-scenario-cards-"),
  );
  directories.push(directory);
  const host = new DesktopHost({
    dataDir: directory,
    fs: new RecordingFsSink(),
    egress: new RecordingEgressSink(),
    confirm: { ask: async () => true },
    secretStore: () => new MemorySecretStore(),
  });
  hosts.push(host);
  await host.initialize();
  const selectedFoundation = await scenarioFoundation(host, foundation);
  const put = async (bytes: Uint8Array) => {
    const preview = (await host.preview(bytes)) as {
      token: string;
      type: string;
    };
    expect(preview.type).toBe("component");
    const item = await host.importLibrary(preview.token);
    if (!("manifest" in item)) throw Error("Expected a component artifact");
    return item;
  };
  const digests = [];
  for (const parser of parserNames)
    digests.push((await put(await packExtension(parser))).digest);
  const cards: Record<string, string> = {};
  for (const name of ["v1", "v2", "v3", "non-card", "png"]) {
    const bytes =
      name === "png"
        ? cardPng(await cardFixture("v3"))
        : await cardFixture(name);
    const artifact = await put(bytes);
    digests.push(artifact.digest);
    cards[name] = artifact.manifest.id;
  }
  const declaration = desktopContribution(await fixtureManifest("card-parser"))!
    .contributes!.tools![0]!;
  const consumer: ManifestV2 = {
    formatVersion: "2.0",
    kind: "extension",
    id: "fixture.card-reader",
    name: "Test protocol consumer",
    version: "1.0.0",
    description: "Synthetic SDK consumer",
    dependencies: [],
    permissions: [],
    payload: {
      plumsDesktop: {
        sdkVersion: "2",
        runtime: "main.js",
        foundation: {
          ...scenarioBinding(selectedFoundation).requirement,
          features: ["sdk.register", "sdk.protocols"],
        },
        contributes: {
          commands: [{ ...declaration, name: "read", title: "Read test card" }],
        },
        protocols: {
          requires: [
            {
              id: "card",
              protocol: "org.plums.character-card",
              range: "^1.0.0",
              features: ["parse", "list"],
            },
          ],
        },
      },
    },
  };
  digests.push(
    (
      await put(
        await createArchive({
          "manifest.json": Buffer.from(JSON.stringify(consumer)),
          "main.js": Buffer.from(
            "export function activate(sdk){sdk.register('commands','read',request=>sdk.protocols.invoke('card',request));}",
          ),
        }),
      )
    ).digest,
  );
  const plan = await host.planAssembly(digests);
  const selection = plan.protocols[0]!.candidates.find(
    (candidate) => candidate.intent.providerId === `fixture.${parserNames[0]}`,
  )!.intent;
  const agent = await host.createAgent(
    "Synthetic card scenario",
    digests,
    cards.v2,
    undefined,
    parserNames.length === 1 ? [] : [selection],
    scenarioBinding(selectedFoundation),
  );
  for (const parser of parserNames)
    await host.enable(agent.instanceId, `fixture.${parser}`);
  for (const id of Object.values(cards))
    await host.enable(agent.instanceId, id);
  await host.enable(agent.instanceId, consumer.id);
  const parse = (parser: string, characterId?: string) =>
    host.invoke(
      agent.instanceId,
      `fixture.${parser}`,
      `fixture.${parser}`,
      "tools",
      "card",
      {
        operation: "parse",
        input: { ...(characterId === undefined ? {} : { characterId }) },
      },
    );
  const read = (input = {}) =>
    host.invoke(
      agent.instanceId,
      consumer.id,
      consumer.id,
      "commands",
      "read",
      { operation: "parse", input },
    );
  const protocols = () =>
    host.protocolPlan(agent.instanceId) as Promise<
      Awaited<ReturnType<typeof protocolPlan>>
    >;
  return { host, agent, digests, cards, put, parse, read, consumer, protocols };
}

it.each(parsers)(
  "packs %s through preview/importLibrary with complete v2 schemas and immutable deduplication",
  async (name) => {
    const f = await fixture([name]);
    const manifest = await fixtureManifest(name);
    const declaration = desktopContribution(manifest)!;
    expect(manifest.formatVersion).toBe("2.0");
    expect(declaration.sdkVersion).toBe("2");
    expect(manifest.permissions).toEqual([]);
    expect(declaration.contributes!.tools![0]).toHaveProperty("inputSchema");
    expect(declaration.contributes!.tools![0]).toHaveProperty("outputSchema");
    expect((await f.protocols()).requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          consumerId: f.consumer.id,
          autoBound: true,
          state: "bound",
        }),
      ]),
    );
    const first = await f.put(await packExtension(name));
    expect(first.digest).toBe(f.digests[0]);
    expect((await f.put(await packExtension(name))).digest).toBe(first.digest);
    expect(
      (await f.host.listLibrary()).filter(
        (item) => item.manifest.id === manifest.id,
      ),
    ).toHaveLength(1);
  },
);

it.each(parsers)(
  "%s parses V1/V2/V3 and generated PNG through its real isolate while preserving raw cards",
  async (name) => {
    const f = await fixture([name]);
    for (const [card, expected] of [
      ["v1", expectedV1],
      ["v2", expectedV2],
      ["v3", expectedV3],
      ["png", expectedV3],
    ] as const)
      expect(await f.parse(name, f.cards[card])).toEqual(expected);
    expect(await f.parse(name)).toEqual(expectedV2);
    for (const card of ["v1", "v2", "v3"]) {
      const item = (await f.host.listLibrary()).find(
        (item) => item.manifest.id === f.cards[card],
      )!;
      const artifact = await f.host.library.get(item.digest);
      expect(artifact.contents.manifest.payload).toEqual(
        JSON.parse((await cardFixture(card)).toString()),
      );
      expect(artifact.contents.files["source/card.json"]).toEqual(
        new Uint8Array(await cardFixture(card)),
      );
    }
  },
);

it.each(parsers)(
  "%s returns fixed business errors for non-cards and malformed card fields without changing opaque import",
  async (name) => {
    const f = await fixture([name]);
    expect(await f.parse(name, f.cards["non-card"])).toEqual(unrecognized);
    const v2 = JSON.parse((await cardFixture("v2")).toString());
    const broken = [
      { ...v2, spec: "unsupported" },
      { ...v2, spec_version: "wrong" },
      { ...v2, data: { ...v2.data, name: 7 } },
      { ...v2, data: { ...v2.data, tags: [1] } },
      { ...v2, data: { ...v2.data, extensions: [] } },
      {
        ...v2,
        data: {
          ...v2.data,
          character_book: {
            entries: [
              {
                keys: [],
                content: "broken",
                enabled: "yes",
                insertion_order: 1,
              },
            ],
          },
        },
      },
      {
        ...v2,
        data: { ...v2.data, character_book: { entries: [], scan_depth: -1 } },
      },
      ...[
        { entries: [], token_budget: "invalid" },
        { entries: [], recursive_scanning: "invalid" },
        {
          entries: [
            { ...v2.data.character_book.entries[0], use_regex: "invalid" },
          ],
        },
      ].map((character_book) => ({
        ...v2,
        data: { ...v2.data, character_book },
      })),
      {
        ...v2,
        data: {
          ...v2.data,
          character_book: {
            entries: [
              {
                keys: [],
                content: "broken",
                enabled: true,
                insertion_order: 1,
                position: "invalid",
              },
            ],
          },
        },
      },
    ];
    for (const payload of broken) {
      const item = await f.put(Buffer.from(JSON.stringify(payload)));
      await f.host.addLibraryComponent(f.agent.instanceId, item.digest);
      await f.host.enable(f.agent.instanceId, item.manifest.id);
      expect(await f.parse(name, item.manifest.id)).toEqual(unrecognized);
      expect(
        (await f.host.library.get(item.digest)).contents.manifest.payload,
      ).toEqual(payload);
    }
  },
);

it("replaces the card provider without changing the consumer and returns identical normalized output", async () => {
  const f = await fixture();
  const primary = desktopContribution(await fixtureManifest("card-parser"))!
    .contributes!.tools![0]!;
  const alternateSchema = desktopContribution(
    await fixtureManifest("card-parser-alt"),
  )!.contributes!.tools![0]!;
  expect(alternateSchema.inputSchema).toEqual(primary.inputSchema);
  expect(alternateSchema.outputSchema).toEqual(primary.outputSchema);
  const first = await f.read();
  expect(first).toEqual(expectedV2);
  const plan = await f.protocols();
  const requirement = plan.requirements.find(
    (item) => item.consumerId === f.consumer.id,
  )!;
  const alternate = requirement.candidates.find(
    (candidate) => candidate.intent.providerId === "fixture.card-parser-alt",
  )!.intent;
  await f.host.setProtocolBinding(
    f.agent.instanceId,
    plan.fingerprint,
    f.consumer.id,
    "card",
    alternate,
  );
  expect(await f.read()).toEqual(first);
  expect(await f.read({ characterId: f.cards.v3 })).toEqual(expectedV3);
  const artifact = (await f.host.listLibrary()).find(
    (item) => item.manifest.id === f.consumer.id,
  )!;
  expect((await f.host.library.get(artifact.digest)).contents.manifest).toEqual(
    f.consumer,
  );
});

it.each(parsers)(
  "%s lists only current Agent enabled cards and obeys missing/foreign/default selection",
  async (name) => {
    const f = await fixture([name]);
    const foreign = await f.put(
      Buffer.from(
        JSON.stringify({
          ...JSON.parse((await cardFixture("v1")).toString()),
          name: "Foreign synthetic card",
        }),
      ),
    );
    const other = await f.host.createAgent(
      "Other synthetic Agent",
      [f.digests[0]!, foreign.digest],
      foreign.manifest.id,
    );
    await f.host.enable(other.instanceId, `fixture.${name}`);
    await f.host.enable(other.instanceId, foreign.manifest.id);
    await expect(f.parse(name, foreign.manifest.id)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    await f.host.disable(f.agent.instanceId, f.cards.v1!);
    const listed = (await f.host.invoke(
      f.agent.instanceId,
      `fixture.${name}`,
      `fixture.${name}`,
      "tools",
      "card",
      { operation: "list", input: {} },
    )) as { id: string }[];
    expect(listed.map((item) => item.id).sort()).toEqual(
      Object.entries(f.cards)
        .filter(([name]) => name !== "v1")
        .map(([, id]) => id)
        .sort(),
    );
    await expect(f.parse(name, f.cards.v1)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    await f.host.setCharacter(f.agent.instanceId, f.cards.v3);
    expect(await f.parse(name)).toEqual(expectedV3);
    await f.host.setCharacter(f.agent.instanceId);
    expect(await f.parse(name)).toEqual(unrecognized);
    const exported = await f.host.exportAgent(f.agent.instanceId);
    expect(exported).toBeInstanceOf(Uint8Array);
  },
);

it.each(parsers)(
  "%s enforces the protocol input schema before calling its handler",
  async (name) => {
    const f = await fixture([name]);
    for (const input of [
      { operation: "unknown", input: {} },
      { operation: "parse", input: { characterId: 3 } },
      { operation: "list", input: { characterId: f.cards.v1 } },
      { operation: "parse" },
    ])
      await expect(
        f.host.invoke(
          f.agent.instanceId,
          `fixture.${name}`,
          `fixture.${name}`,
          "tools",
          "card",
          input,
        ),
      ).rejects.toMatchObject({
        code: "CAPABILITY_FAILED",
        path: "/input",
        details: {
          reason: "CONTRIBUTION_INPUT_INVALID",
          executionState: "not_started",
        },
      });
  },
);

it.each(parsers)(
  "%s normalizes omitted extensions, V3 minor versions and secondary keys without losing opaque extension keys",
  async (name) => {
    const f = await fixture([name]);
    const raw = JSON.parse((await cardFixture("v3")).toString());
    raw.spec_version = "3.1";
    delete raw.data.extensions;
    delete raw.data.character_book.extensions;
    raw.data.character_book.entries[0].secondary_keys = " night, fog , ";
    raw.data.character_book.entries[0].extensions = JSON.parse(
      '{"__proto__":{"opaque":true},"constructor":{"preserve":true}}',
    );
    delete raw.data.character_book.entries[1].extensions;
    const item = await f.put(Buffer.from(JSON.stringify(raw)));
    await f.host.addLibraryComponent(f.agent.instanceId, item.digest);
    await f.host.enable(f.agent.instanceId, item.manifest.id);
    expect(await f.parse(name, item.manifest.id)).toEqual({
      ...expectedV3,
      extensions: {},
      characterBook: {
        ...expectedV3.characterBook,
        extensions: {},
        entries: [
          {
            ...expectedV3.characterBook.entries[0],
            secondaryKeys: ["night", "fog"],
            extensions: raw.data.character_book.entries[0].extensions,
          },
          expectedV3.characterBook.entries[1],
          expectedV3.characterBook.entries[2],
        ],
      },
    });
  },
);

it("keeps source fixtures text-only and excludes their code and manifests from every built package", async () => {
  async function files(directory: string): Promise<string[]> {
    const result: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const at = path.join(directory, entry.name);
      if (entry.isDirectory()) result.push(...(await files(at)));
      else result.push(at);
    }
    return result;
  }
  expect(
    (await files(fixturesDirectory)).filter((at) => /\.(zip|png)$/i.test(at)),
  ).toEqual([]);
  for (const name of ["core", "cli", "sdk", "host", "desktop"]) {
    const built = await files(path.resolve(`packages/${name}/dist`));
    expect(
      built.some((at) => at.includes("/test/") || at.includes("/fixtures/")),
    ).toBe(false);
    for (const at of built.filter((at) => /\.(json|js|cjs|mjs|html)$/.test(at)))
      for (const marker of [
        "Test-only character parser; not distributed",
        "CARD_UNRECOGNIZED",
        "fixture.card-parser",
      ])
        expect(await readFile(at, "utf8")).not.toContain(marker);
  }
});
