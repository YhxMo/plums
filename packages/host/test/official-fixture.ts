import type { ControlledExecution } from "../src/controlled-execution.js";
import type { DesktopHost } from "../src/host.js";
import { FoundationRegistry } from "../src/foundation-factory.js";
import {
  createOfficialFoundationSession,
  OFFICIAL_FOUNDATION_PROVIDER,
} from "../src/official-foundation.js";
/** Trusted test seam for observing source-class preparation faults. Product archive tests use real ZIP loading. */
export async function useSourceOfficialFixture(
  host: DesktopHost,
  observe?: (controlled: ControlledExecution, componentId: string) => void,
) {
  const internal = host as any,
    selection = await internal.officialArtifacts.current(),
    registry = new FoundationRegistry(),
    reference = {
      id: selection.id,
      version: selection.version,
      digest: selection.digest,
    };
  registry.register({
    provider: OFFICIAL_FOUNDATION_PROVIDER,
    version: selection.version,
    selection,
    create: async (options) => {
      const session = createOfficialFoundationSession(
        options,
        internal.options.nodePath ?? process.execPath,
      );
      observe?.(
        (session as unknown as { controlled: ControlledExecution }).controlled,
        options.actor.componentId,
      );
      return session;
    },
  });
  internal.foundations = registry;
  internal.foundationRegistrations = new Map([
    [
      JSON.stringify([
        selection.source,
        selection.id,
        selection.version,
        selection.digest,
      ]),
      Promise.resolve(reference),
    ],
  ]);
}
