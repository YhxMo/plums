import path from "node:path";
import type { Confirm, EgressSink, ModelProvider, SecretStore } from "./types.js";
import { VERSION } from "./version.js";

export interface CreateCoreOptions {
  dataDir: string;
  model: ModelProvider;
  egress: EgressSink;
  confirm: Confirm;
  secrets: SecretStore;
}

export interface Core {
  readonly version: string;
  readonly dataDir: string;
  readonly model: ModelProvider;
  readonly egress: EgressSink;
  readonly confirm: Confirm;
  readonly secrets: SecretStore;
}

export function createCore(options: CreateCoreOptions): Core {
  if (options === null || typeof options !== "object") {
    throw new TypeError("createCore options are required");
  }
  const dataDir = requireNonEmptyString(options.dataDir, "dataDir");
  requireMethod(options.model, "model", "complete");
  requireMethod(options.egress, "egress", "send");
  requireMethod(options.confirm, "confirm", "ask");
  requireMethod(options.secrets, "secrets", "get");
  requireMethod(options.secrets, "secrets", "set");
  requireMethod(options.secrets, "secrets", "delete");

  return {
    version: VERSION,
    dataDir: path.resolve(dataDir),
    model: options.model,
    egress: options.egress,
    confirm: options.confirm,
    secrets: options.secrets,
  };
}

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`createCore ${name} must be a non-empty string`);
  }
  return value;
}

function requireMethod(value: unknown, name: string, method: string): void {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof (value as Record<string, unknown>)[method] !== "function"
  ) {
    throw new TypeError(`createCore ${name} must implement ${method}()`);
  }
}
