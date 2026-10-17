import { useState } from "react";
import type { Runtime } from "./runtime";
import {
  createExtensionState,
  type ExtensionPreferences,
} from "./extension-state";

export function useExtensionState(runtime: Runtime) {
  const [value, setValue] = useState<ExtensionPreferences>(() => ({
    imports: runtime.initial.imports,
    configurations: runtime.initial.configurations,
    composition: runtime.initial.composition,
  }));
  const [run] = useState(() => createExtensionState(value, runtime, setValue));
  return { value, run };
}
