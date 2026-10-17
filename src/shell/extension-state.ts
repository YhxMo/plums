import type { ExtensionState } from "../../modules/shell/extension-actions";

export type ExtensionPreferences = Pick<
  ExtensionState,
  "imports" | "configurations" | "composition"
>;

/** Serialize read/modify/save together; publish the action's confirmed results. */
export function createExtensionState(
  initial: ExtensionPreferences,
  services: Pick<ExtensionState, "catalog" | "save">,
  publish: (value: ExtensionPreferences) => void,
) {
  let confirmed = initial;
  let queue: Promise<unknown> = Promise.resolve();
  return function run<T>(work: (draft: ExtensionState) => Promise<T>) {
    const pending = queue.then(async () => {
      const draft: ExtensionState = {
        ...confirmed,
        catalog: services.catalog,
        save: services.save,
      };
      try {
        return await work(draft);
      } finally {
        // A failed final uninstall can still have a confirmed composition prune.
        if (
          draft.imports !== confirmed.imports ||
          draft.configurations !== confirmed.configurations ||
          draft.composition !== confirmed.composition
        ) {
          confirmed = {
            imports: draft.imports,
            configurations: draft.configurations,
            composition: draft.composition,
          };
          publish(confirmed);
        }
      }
    });
    queue = pending.catch(() => {});
    return pending;
  };
}
