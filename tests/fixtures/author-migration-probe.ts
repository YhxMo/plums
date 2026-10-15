import {
  migrateState,
  type ExtensionDefinition,
  type StateMigration,
  type StoredState,
} from "../../modules/sdk/index";

export const oldValue = { version: 1, data: { label: "plum" } };

export const plan: StateMigration = {
  from: 1,
  to: 2,
  migrate(data) {
    if (
      data === null ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      !("label" in data) ||
      typeof data.label !== "string"
    ) {
      throw Error("Expected version 1 label string");
    }
    return { labels: [data.label] };
  },
  validate(data) {
    return (
      data !== null &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      "labels" in data &&
      Array.isArray(data.labels) &&
      data.labels.every((label: unknown) => typeof label === "string")
    );
  },
};

export function createMigrationProbe(
  id: string,
  version = "2",
): ExtensionDefinition {
  return {
    manifest: {
      id,
      version,
      apiVersion: 1,
      capabilities: ["state.read", "state.write"],
      provides: { [`${id}.state`]: 1 },
    },
    activate(ctx) {
      ctx.provide(`${id}.state`, 1, {
        read() {
          return ctx.platform("state.read") as Promise<StoredState | null>;
        },
        async seed(value: unknown) {
          const stored = (await ctx.platform(
            "state.read",
          )) as StoredState | null;
          return ctx.platform("state.write", {
            revision: stored?.revision ?? 0,
            value,
          }) as Promise<StoredState>;
        },
        migrate(signal?: AbortSignal, override?: Partial<StateMigration>) {
          return migrateState(ctx, { ...plan, ...override }, signal);
        },
      });
    },
  };
}
