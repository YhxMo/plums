import { desktopContribution, type FoundationProvider } from "@plumsjs/sdk";
import {
  ControlledExecution,
  type ControlledProcess,
} from "./controlled-execution.js";
import { ExtensionRuntime } from "./runtime.js";
import {
  FoundationRegistry,
  foundationFailure,
  type FoundationReference,
} from "./foundation-factory.js";
import {
  copyInvocationContext,
  type FoundationAdapterOptions,
  type HostFoundationSession,
  type InvocationContext,
} from "./foundation-runtime.js";

export const OFFICIAL_FOUNDATION_REFERENCE: Readonly<FoundationReference> =
  Object.freeze({ id: "org.plums.foundation", version: "1.0.0" });
const sdk1 = [
  "sdk.register",
  "sdk.settings",
  "sdk.capability",
  "sdk.invoke",
  "sdk.character",
  "sdk.characters",
  "sdk.events",
  "sdk.emit",
  "sdk.mcpCheck",
];
const sdk2 = [
  ...sdk1,
  "sdk.context",
  "sdk.connection",
  "sdk.failResponse",
  "sdk.resources",
  "sdk.protocols",
  "sdk.common",
  "sdk.engine",
];
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export const OFFICIAL_FOUNDATION_PROVIDER: FoundationProvider = freeze({
  declarationVersion: "1.1",
  id: OFFICIAL_FOUNDATION_REFERENCE.id,
  foundationVersion: "1.0",
  entry: "official-foundation.js",
  execution: "builtin-adapter",
  platforms: ["darwin-arm64"],
  features: [
    "session.invoke",
    "session.callback",
    "session.cancel",
    "session.events",
  ],
  hostFeatures: [],
  sdks: [
    {
      id: "org.plums.sdk",
      range: "1.0.0 || 2.0.0",
      features: sdk1,
      featureRanges: [
        { range: "2.0.0", features: sdk2.filter((f) => !sdk1.includes(f)) },
      ],
    },
  ],
});

/** Official workers/bootstrap/transport remain implementation details of this adapter. */
class OfficialSession implements HostFoundationSession {
  readonly instanceId: string;
  private stopped = false;
  private prepared?: Promise<void>;
  private activation?: Promise<void>;
  private closing?: Promise<void>;
  private runtime?: ExtensionRuntime;
  private process?: ControlledProcess;
  private declaration;
  constructor(
    private options: FoundationAdapterOptions,
    private nodePath: string,
    private controlled: ControlledExecution,
    private ownsControlled = false,
  ) {
    this.instanceId = options.binding.instanceId;
    this.declaration = desktopContribution(
      options.component.manifest,
      options.component.files,
    )!;
  }
  get alive() {
    return !this.stopped && (!this.runtime || this.runtime.alive);
  }
  private check() {
    if (!this.alive) throw foundationFailure("FOUNDATION_STOPPED");
    try {
      this.options.assertCurrent();
    } catch (error) {
      this.stop();
      throw error;
    }
  }
  ready(): Promise<void> {
    if (!this.alive)
      return Promise.reject(foundationFailure("FOUNDATION_STOPPED"));
    return (this.prepared ??= Promise.resolve()
      .then(async () => {
        this.check();
        await this.options.assertActive();
        this.check();
      })
      .catch((error) => {
        this.stop();
        throw error;
      }));
  }
  activate(): Promise<void> {
    if (!this.alive)
      return Promise.reject(foundationFailure("FOUNDATION_STOPPED"));
    return (this.activation ??= this.start());
  }
  private async start(): Promise<void> {
    try {
      await this.ready();
      await this.options.assertActive();
      this.check();
      if (this.declaration.common?.runtime === "controlled-node") {
        let output = Buffer.alloc(0);
        this.process = await this.controlled.launchNode(
          this.options.component.files,
          this.declaration.runtime!,
          (kind, data) => {
            if (kind !== "stdout" || this.stopped) return;
            output = Buffer.concat([output, data]);
            if (output.length > 1024 * 1024) {
              this.stop();
              return;
            }
            let at: number;
            while ((at = output.indexOf(10)) >= 0) {
              const line = output.subarray(0, at);
              output = output.subarray(at + 1);
              try {
                this.runtime?.receiveControlled(JSON.parse(line.toString()));
              } catch {
                this.stop();
                return;
              }
            }
          },
          () => this.check(),
        );
      }
      this.check();
      const files = this.process
        ? {}
        : Object.fromEntries(
            Object.entries(this.options.component.files)
              .filter(([p]) => p.endsWith(".js"))
              .map(([p, b]) => [
                p,
                new TextDecoder("utf-8", { fatal: true }).decode(b),
              ]),
          );
      this.runtime = new ExtensionRuntime(
        this.options.component.manifest.id,
        this.declaration,
        this.options.bridge,
        files,
        this.nodePath,
        this.process,
        () => this.check(),
        undefined,
        this.instanceId,
        false,
        this.options.trackProcess,
      );
      await this.runtime.ready();
      await this.options.assertActive();
      this.check();
      this.activated = true;
    } catch (error) {
      this.stop();
      throw error;
    }
  }
  private active(): ExtensionRuntime {
    this.check();
    if (!this.runtime || !this.activated)
      throw foundationFailure("FOUNDATION_NOT_ACTIVE");
    return this.runtime;
  }
  private activated = false;
  invoke(
    kind: "commands" | "tools" | "connectors",
    name: string,
    input: unknown,
    context: InvocationContext,
  ): Promise<unknown> {
    try {
      return this.active().invoke(
        kind,
        name,
        input,
        copyInvocationContext(context),
      );
    } catch (error) {
      return Promise.reject(error);
    }
  }
  deliverEvent(
    topic: string,
    event: unknown,
    context: InvocationContext,
  ): Promise<unknown> {
    try {
      return this.active().deliverEvent(
        topic,
        structuredClone(event),
        copyInvocationContext(context),
      );
    } catch (error) {
      return Promise.reject(error);
    }
  }
  stop(): void {
    this.stopped = true;
    this.runtime?.stop();
    if (this.process && !this.runtime) void this.process.stop();
  }
  cancel(): Promise<void> {
    return this.close();
  }
  close(): Promise<void> {
    this.stop();
    return (this.closing ??= (async () => {
      await this.activation?.catch(() => {});
      if (this.runtime) await this.runtime.close();
      else if (this.process) {
        await this.process.stop();
        await this.process.cleaned;
      }
      if (this.ownsControlled) await this.controlled.close();
    })());
  }
}
export function createOfficialFoundationSession(
  options: FoundationAdapterOptions,
  nodePath = process.execPath,
): HostFoundationSession {
  return new OfficialSession(
    options,
    nodePath,
    new ControlledExecution(
      nodePath,
      options.trackProcess,
      options.allocateSnapshot,
    ),
    true,
  );
}
export function createOfficialFoundationRegistry(
  nodePath = process.execPath,
  controlled = new ControlledExecution(nodePath),
): FoundationRegistry {
  const registry = new FoundationRegistry();
  registry.register({
    provider: OFFICIAL_FOUNDATION_PROVIDER,
    version: OFFICIAL_FOUNDATION_REFERENCE.version,
    create: async (options) =>
      new OfficialSession(
        options,
        nodePath,
        options.trackProcess
          ? new ControlledExecution(
              nodePath,
              options.trackProcess,
              options.allocateSnapshot,
            )
          : controlled,
        !!options.trackProcess,
      ),
  });
  return registry;
}
