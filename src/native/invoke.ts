import { invoke } from "@tauri-apps/api/core";
import type { NativeCommands } from "./contract.generated";

type EmptyCommands<C extends Record<keyof C, { args: object }>> = {
  [K in keyof C]: C[K]["args"] extends Record<string, never> ? K : never;
}[keyof C];
export function invokeNative<K extends EmptyCommands<NativeCommands>>(
  command: K,
): Promise<NativeCommands[K]["response"]>;
export function invokeNative<K extends keyof NativeCommands>(
  command: K,
  args: NativeCommands[K]["args"],
): Promise<NativeCommands[K]["response"]>;
export function invokeNative(command: keyof NativeCommands, args?: object) {
  return invoke(command, args as Record<string, unknown> | undefined);
}
