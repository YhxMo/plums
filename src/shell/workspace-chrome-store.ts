import type { WorkspaceChrome, WorkspaceChromeState } from "@modules/sdk";

const empty: WorkspaceChromeState = {};
type Snapshot = { state: WorkspaceChromeState; failure?: { reason: unknown } };

/** Extension callbacks must not escape into the shell's render or teardown. */
export function createChromeStore(
  chrome: WorkspaceChrome | undefined,
  onReleaseError: (reason: unknown) => void,
) {
  let snapshot: Snapshot = { state: empty };
  function fail(reason: unknown) {
    snapshot = { state: empty, failure: { reason } };
  }
  return {
    getSnapshot() {
      if (!snapshot.failure) {
        try {
          const state = chrome?.getSnapshot() ?? empty;
          if (state !== snapshot.state) snapshot = { state };
        } catch (reason) {
          fail(reason);
        }
      }
      return snapshot;
    },
    subscribe(listener: () => void) {
      let active = true;
      let release: (() => void) | undefined;
      try {
        if (!snapshot.failure)
          release = chrome?.subscribe(() => {
            if (active) listener();
          });
      } catch (reason) {
        fail(reason);
      }
      return () => {
        active = false;
        try {
          release?.();
        } catch (reason) {
          onReleaseError(reason);
        }
      };
    },
  };
}
