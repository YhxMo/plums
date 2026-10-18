import { invoke } from "@tauri-apps/api/core";
import type { ExperimentalCommands } from "../../src/native/experimental.generated";

type EmptyCommands = {
  [
    K in keyof ExperimentalCommands
  ]: ExperimentalCommands[K]["args"] extends Record<string, never> ? K : never;
}[keyof ExperimentalCommands];

/** Test-feature bridge. Ordinary builds never register these extra commands. */
export function invokeExperimental<K extends EmptyCommands>(
  command: K,
): Promise<ExperimentalCommands[K]["response"]>;
export function invokeExperimental<K extends keyof ExperimentalCommands>(
  command: K,
  args: ExperimentalCommands[K]["args"],
): Promise<ExperimentalCommands[K]["response"]>;
export function invokeExperimental(
  command: keyof ExperimentalCommands,
  args?: object,
) {
  return invoke(command, args as Record<string, unknown> | undefined);
}
