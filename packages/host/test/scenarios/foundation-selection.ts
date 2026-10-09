import { readFile } from "node:fs/promises";
import type { FoundationSelection } from "@plums/sdk";
import type { DesktopHost } from "../../src/host.js";

/** Fresh scenario data only; caller-supplied foundation archives are explicit test inputs. */
export async function scenarioFoundation(
  host: DesktopHost,
  selected?: FoundationSelection,
): Promise<FoundationSelection> {
  if (selected) return selected;
  const archive = process.env.PLUMS_SCENARIO_FOUNDATION_ARCHIVE;
  if (!archive) return host.restoreBuiltinFoundation();
  const preview = (await host.preview(await readFile(archive))) as {
    token: string;
  };
  const artifact = await host.importLibrary(preview.token);
  if ("selection" in artifact) return artifact.selection;
  const candidate = (await host.listFoundations()).find(
    (f) => f.selection.digest === artifact.digest,
  );
  if (!candidate) throw Error("Scenario input is not a foundation");
  return candidate.selection;
}

export function scenarioBinding(selection: FoundationSelection) {
  return {
    requirement: {
      requirementVersion: "1.0" as const,
      protocolRange: "^1.0.0",
      sdk: { id: "org.plums.sdk", version: "2.0.0" },
      features: ["sdk.register"],
    },
    selection,
  };
}
