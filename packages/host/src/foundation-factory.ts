import semver from "semver";
import { randomUUID } from "node:crypto";
import { CAPABILITY_FAILED, PlumsError } from "@plums/core";
import {
  checkFoundationCompatibility,
  desktopContribution,
  parseFoundationProvider,
  validateContributionValue,
  type DesktopContribution,
  type ContributionKind,
  type FoundationProvider,
} from "@plums/sdk";
import type {
  FoundationSessionOptions,
  FoundationAdapterOptions,
  HostFoundationSession,
} from "./foundation-runtime.js";
import {
  copyInvocationContext,
  type InvocationContext,
} from "./foundation-runtime.js";

/** Trusted adapter reference; persisted artifact selection is a separate contract. */
export interface FoundationReference {
  id: string;
  version: string;
}
export interface FoundationRegistration {
  provider: FoundationProvider;
  version: string;
  create(options: FoundationAdapterOptions): Promise<HostFoundationSession>;
}
export function foundationFailure(reason: string): PlumsError {
  return new PlumsError({
    code: CAPABILITY_FAILED,
    message: "底座无法运行当前组件。",
    details: { reason, executionState: "not_started" },
  });
}
/** Registration is a trusted host operation, never a component SDK operation. */
export class FoundationRegistry {
  private registrations = new Map<string, FoundationRegistration>();
  private cleanup = new Map<
    HostFoundationSession,
    { agentId: string; pending: Promise<void> }
  >();
  constructor(
    private hostFeatures: readonly string[] = [],
    private platform = process.platform + "-" + process.arch,
  ) {
    this.hostFeatures = [...hostFeatures];
  }
  register(registration: FoundationRegistration): void {
    const provider = parseFoundationProvider(registration.provider);
    if (
      !semver.valid(registration.version) ||
      typeof registration.create !== "function"
    )
      throw foundationFailure("FOUNDATION_INVALID");
    const key = JSON.stringify([provider.id, registration.version]);
    if (this.registrations.has(key))
      throw foundationFailure("FOUNDATION_ALREADY_REGISTERED");
    this.registrations.set(key, {
      provider,
      version: registration.version,
      create: registration.create,
    });
  }
  describe(reference: FoundationReference): FoundationProvider {
    return structuredClone(this.resolve(reference).provider);
  }
  private resolve(reference: FoundationReference): FoundationRegistration {
    const registration = this.registrations.get(
      JSON.stringify([reference.id, reference.version]),
    );
    if (!registration) throw foundationFailure("FOUNDATION_UNAVAILABLE");
    return registration;
  }
  async create(
    reference: FoundationReference,
    options: FoundationSessionOptions,
  ): Promise<HostFoundationSession> {
    const registration = this.resolve({ ...reference });
    const copied = {
      ...options,
      component: structuredClone(options.component),
      actor: Object.freeze({ ...options.actor }),
      binding: Object.freeze({ ...options.actor, instanceId: randomUUID() }),
    };
    if (
      copied.actor.componentId !== copied.component.manifest.id ||
      copied.actor.componentVersion !== copied.component.manifest.version
    )
      throw foundationFailure("FOUNDATION_INVALID");
    const declaration = desktopContribution(
      copied.component.manifest,
      copied.component.files,
    );
    if (!declaration?.runtime) throw foundationFailure("FOUNDATION_INVALID");
    const sdkVersion = declaration.sdkVersion === "2" ? "2.0.0" : "1.0.0";
    const requirement = declaration.foundation ?? {
      requirementVersion: "1.0" as const,
      protocolRange: "^1.0.0",
      sdk: { id: "org.plums.sdk", version: sdkVersion },
      features: [],
    };
    if (
      requirement.sdk.id !== "org.plums.sdk" ||
      requirement.sdk.version !== sdkVersion ||
      !checkFoundationCompatibility(
        registration.provider,
        requirement,
        this.platform,
        this.hostFeatures,
      ).compatible
    )
      throw foundationFailure("FOUNDATION_INCOMPATIBLE");
    await copied.assertActive();
    copied.assertCurrent();
    const session = await registration.create(copied);
    try {
      if (session.instanceId !== copied.binding.instanceId)
        throw foundationFailure("FOUNDATION_INVALID");
      await copied.assertActive();
      copied.assertCurrent();
      return new AuthorizedFoundationSession(
        session,
        structuredClone(declaration),
        copied,
      );
    } catch (error) {
      const pending = (async () => {
        let stopFailed = false;
        try {
          session.stop();
        } catch {
          stopFailed = true;
        }
        try {
          await session.close();
        } catch {
          throw foundationFailure("FOUNDATION_CLEANUP_FAILED");
        }
        if (stopFailed) throw foundationFailure("FOUNDATION_CLEANUP_FAILED");
      })();
      this.cleanup.set(session, { agentId: copied.actor.agentId, pending });
      void pending.then(
        () => this.cleanup.delete(session),
        () => {},
      );
      await pending;
      throw error;
    }
  }
  /** Pre-return failures remain factory-owned; successful returns belong to the caller. */
  async settleCleanup(agentId?: string): Promise<void> {
    const settled = await Promise.allSettled(
      [...this.cleanup.values()]
        .filter((c) => agentId === undefined || c.agentId === agentId)
        .map((c) => c.pending),
    );
    const failed = settled.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
}
/** Contribution and policy gates belong to the host, independently of the adapter. */
class AuthorizedFoundationSession implements HostFoundationSession {
  private active = false;
  private stopped = false;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private session: HostFoundationSession,
    private declaration: DesktopContribution,
    private options: FoundationSessionOptions,
  ) {}
  get instanceId() {
    return this.session.instanceId;
  }
  get alive() {
    return !this.stopped && this.session.alive;
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
  private async recheck(context?: InvocationContext): Promise<void> {
    if (!this.alive) throw foundationFailure("FOUNDATION_STOPPED");
    // An edge denial rejects this call; it must reach the existing SDK error
    // transport before any instance stop can discard that denial.
    await context?.assertActive?.();
    this.check();
    try {
      await this.options.assertActive();
      this.check();
    } catch (error) {
      this.stop();
      throw error;
    }
    if (context?.signal.aborted) throw foundationFailure("FOUNDATION_STOPPED");
  }
  async ready(): Promise<void> {
    await this.recheck();
    await this.session.ready();
    await this.recheck();
  }
  async activate(): Promise<void> {
    await this.recheck();
    await this.session.activate();
    await this.recheck();
    this.active = true;
  }
  private context(context: InvocationContext): InvocationContext {
    this.check();
    if (!this.active) throw foundationFailure("FOUNDATION_NOT_ACTIVE");
    if (context.signal.aborted) throw foundationFailure("FOUNDATION_STOPPED");
    return copyInvocationContext(context);
  }
  invoke(
    kind: ContributionKind,
    name: string,
    input: unknown,
    context: InvocationContext,
  ): Promise<unknown> {
    let copied: unknown, call: InvocationContext;
    try {
      copied = structuredClone(input);
      call = this.context(context);
    } catch (error) {
      return Promise.reject(error);
    }
    const contribution = this.declaration.contributes?.[kind]?.find(
      (c) => c.name === name,
    );
    if (!contribution)
      return Promise.reject(foundationFailure("CONTRIBUTION_NOT_DECLARED"));
    const task = this.queue.then(async () => {
      await this.recheck(call);
      if (
        this.declaration.sdkVersion === "2" &&
        contribution.inputSchema !== undefined
      )
        validateContributionValue(contribution.inputSchema, copied, "input");
      const gate = await this.options.beforeInvoke?.(kind, name, copied, call);
      const original = call;
      const gated = {
        ...call,
        assertActive: async () => {
          await this.recheck(original);
          await gate?.();
          await this.recheck(original);
        },
      };
      await gated.assertActive?.();
      this.check();
      if (gated.signal.aborted) throw foundationFailure("FOUNDATION_STOPPED");
      const result = await this.session.invoke(kind, name, copied, gated);
      if (
        this.declaration.sdkVersion === "2" &&
        contribution.outputSchema !== undefined
      )
        validateContributionValue(contribution.outputSchema, result, "output");
      return result;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
  deliverEvent(
    topic: string,
    event: unknown,
    context: InvocationContext,
  ): Promise<unknown> {
    let copied: unknown, call: InvocationContext;
    try {
      copied = structuredClone(event);
      call = this.context(context);
    } catch (error) {
      return Promise.reject(error);
    }
    const task = this.queue.then(async () => {
      await this.recheck(call);
      return this.session.deliverEvent(topic, copied, {
        ...call,
        assertActive: () => this.recheck(call),
      });
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
  stop(): void {
    this.stopped = true;
    this.session.stop();
  }
  async cancel(): Promise<void> {
    this.stop();
    await this.session.cancel();
  }
  async close(): Promise<void> {
    this.stop();
    await this.session.close();
  }
}
export function createFoundationSession(
  registry: FoundationRegistry,
  reference: FoundationReference,
  options: FoundationSessionOptions,
): Promise<HostFoundationSession> {
  return registry.create(reference, options);
}
