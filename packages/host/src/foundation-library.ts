import {
  foundationProvider,
  parseFoundationSelection,
  desktopContribution,
  type FoundationProvider,
  type FoundationSelection,
} from "@plumsjs/sdk";
import { ComponentLibrary } from "./library.js";
import {
  FoundationRegistry,
  foundationFailure,
  type FoundationReference,
} from "./foundation-factory.js";
import { startVerifiedFoundationSession } from "./foundation-session.js";
export interface LibraryFoundation {
  selection: FoundationSelection;
  provider: FoundationProvider;
}
/** Offline discovery verifies the archive itself, without loading author code. */
export async function discoverLibraryFoundations(
  library: ComponentLibrary,
  onInvalid?: () => void,
): Promise<LibraryFoundation[]> {
  const result: LibraryFoundation[] = [];
  for (const item of await library.list()) {
    try {
      const { contents } = await library.get(item.digest);
      const provider = foundationProvider(contents.manifest, contents.files);
      if (provider)
        result.push({
          selection: {
            selectionVersion: "1.0",
            source: "library",
            id: provider.id,
            version: contents.manifest.version,
            digest: item.digest,
          },
          provider,
        });
    } catch {
      onInvalid?.();
    }
  }
  return result;
}
export interface LibraryFoundationOptions {
  nodePath: string;
  hostFeatures?: readonly string[];
  handshakeTimeoutMs?: number;
  callTimeoutMs?: number;
}
/** Trusted host registration. The package never supplies an adapter function or executable path. */
export async function registerLibraryFoundation(
  registry: FoundationRegistry,
  library: ComponentLibrary,
  selection: FoundationSelection,
  options: LibraryFoundationOptions,
): Promise<FoundationReference> {
  const fixed = parseFoundationSelection(selection),
    settings = { ...options, hostFeatures: [...(options.hostFeatures ?? [])] };
  if (fixed.source !== "library") throw foundationFailure("FOUNDATION_INVALID");
  const read = async () => {
    let artifact: Awaited<ReturnType<ComponentLibrary["get"]>>;
    try {
      artifact = await library.get(fixed.digest);
    } catch {
      throw foundationFailure("FOUNDATION_UNAVAILABLE");
    }
    const provider = foundationProvider(
      artifact.contents.manifest,
      artifact.contents.files,
    );
    if (
      !provider ||
      provider.id !== fixed.id ||
      artifact.contents.manifest.version !== fixed.version
    )
      throw foundationFailure("FOUNDATION_INVALID");
    return { artifact, provider };
  };
  const { provider } = await read();
  registry.register({
    provider,
    version: fixed.version,
    selection: fixed,
    create: async (options) => {
      const { artifact } = await read();
      const declaration = desktopContribution(
        options.component.manifest,
        options.component.files,
      )!;
      return startVerifiedFoundationSession({
        ...settings,
        deferStart: true,
        trackProcess: options.trackProcess,
        allocateSnapshot: options.allocateSnapshot,
        provider: artifact.contents,
        selection: fixed,
        component: options.component,
        actor: options.binding,
        requirement: declaration.foundation ?? {
          requirementVersion: "1.0",
          protocolRange: "^1.0.0",
          sdk: {
            id: "org.plums.sdk",
            version: declaration.sdkVersion === "2" ? "2.0.0" : "1.0.0",
          },
          features: ["sdk.register"],
        },
        bridge: (method, args, context) =>
          options.bridge(method, args, context),
        assertActive: async () => {
          await options.assertActive();
          options.assertCurrent();
        },
      });
    },
  });
  return { id: fixed.id, version: fixed.version, digest: fixed.digest };
}
