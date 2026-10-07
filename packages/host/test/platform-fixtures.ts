import { readFile } from "node:fs/promises";
import path from "node:path";
// Minimal synthetic declarations. No distributable extension or business workflow is included.
export function engineManifest() {
  return {
    formatVersion: "2.0",
    kind: "extension",
    id: "engine-demo",
    name: "Engine boundary fixture",
    version: "1.0.0",
    description: "Synthetic host test",
    license: "Apache-2.0",
    dependencies: [
      { id: "model", kind: "connector", range: "^2.0.0", optional: true },
    ],
    permissions: [
      {
        id: "local-engine",
        kind: "engine",
        target: "local",
        reason: "Test engine trust",
      },
      {
        id: "connector-access",
        kind: "service",
        target: "https",
        operations: ["request"],
        reason: "Test dependency callbacks",
      },
    ],
    payload: {
      plumsDesktop: {
        sdkVersion: "2",
        runtime: "runtime/main.js",
        frontend: "ui/index.html",
        engines: [
          {
            id: "local",
            title: "Fixture",
            entry: "engine/main.mjs",
            runtime: "node",
            platforms: [
              "darwin-arm64",
              "darwin-x64",
              "linux-arm64",
              "linux-x64",
              "win32-arm64",
              "win32-x64",
            ],
            protocol: "jsonrpc-jsonl-v1",
          },
        ],
        contributes: {
          commands: ["start", "status", "run", "cancel", "stop"].map(
            (name) => ({ name, title: name }),
          ),
        },
      },
    },
  };
}
export function connectorManifest() {
  return {
    formatVersion: "2.0",
    kind: "connector",
    id: "model",
    name: "Credential bridge fixture",
    version: "2.0.0",
    description: "Synthetic host test",
    license: "Apache-2.0",
    dependencies: [],
    permissions: [
      {
        id: "model-api",
        kind: "service",
        target: "https",
        operations: ["request"],
        reason: "Test fixed credential injection",
      },
    ],
    payload: {
      plumsDesktop: {
        sdkVersion: "2",
        runtime: "runtime/main.js",
        contributes: { connectors: [{ name: "complete", title: "Fixture" }] },
        connections: [
          {
            id: "api",
            permissionId: "model-api",
            baseURLSetting: "endpoint",
            labelSetting: "model",
            selectorSetting: "protocol",
            credentialProfiles: {
              "OpenAI Chat Completions": [
                {
                  setting: "apiKey",
                  header: "Authorization",
                  prefix: "Bearer ",
                },
              ],
            },
          },
        ],
      },
    },
    settingsSchema: {
      type: "object",
      properties: {
        protocol: {
          type: "string",
          title: "Protocol",
          description: "Fixture connection selector",
          enum: ["OpenAI Chat Completions"],
          default: "OpenAI Chat Completions",
        },
        model: {
          type: "string",
          title: "Model",
          description: "Fixture connection label",
        },
        endpoint: {
          type: "string",
          title: "Endpoint",
          description: "Fixture authorized base URL",
          default: "https://example.com/v1",
        },
        apiKey: {
          type: "string",
          title: "API key",
          description: "Fixture injected credential",
          "x-secret": true,
        },
      },
      required: ["model", "apiKey"],
    },
  };
}
export const connectorRuntime = `export function activate(sdk){sdk.register('connectors','complete',async input=>{const connection=await sdk.connection('api');const reply=await sdk.capability('model-api',{kind:'service',operation:'request',binding:connection.binding,sources:[],input:{path:connection.basePath+'/fixture',method:'POST',body:JSON.stringify(input)}});return JSON.parse(reply.result.body);});}`;
export async function engineFiles(): Promise<Record<string, Uint8Array>> {
  return {
    "engine/main.mjs": await readFile(
      path.resolve("packages/host/test/fixtures/engine-fixture.mjs"),
    ),
    "runtime/main.js": Buffer.from(
      `export function activate(sdk) { sdk.register('commands','start',()=>sdk.engine.start('local'));sdk.register('commands','status',()=>sdk.engine.status('local'));sdk.register('commands','run',input=>sdk.engine.request('local','run',input,input.requestId));sdk.register('commands','cancel',input=>sdk.engine.cancel('local',input.requestId));sdk.register('commands','stop',()=>sdk.engine.stop('local')); }`,
    ),
    "ui/index.html": Buffer.from("<p>Host test fixture</p>"),
  };
}
