import type { FoundationSelection } from "../packages/sdk/src/index.js";

export const SUITE_VERSION: "1.0.0";
export const SDK_CASE_IDS: readonly string[];
export function independentArchive(): Promise<Uint8Array>;
export interface ScenarioSdkCase {
  id: string;
  status: "passed" | "failed";
  requiredFeatures: string[];
  route: string;
  componentDigest?: string;
  expectation?: "execute-supported" | "reject-before-start";
  rejection?: { code: string; reason: string; executionState: string };
  failure?: { code: string; checkLine?: number | null };
}
export interface ScenarioSdkReport {
  reportVersion: "1.0";
  suiteVersion: "1.0.0";
  suiteDigest: string;
  checkedAt: string;
  platform: { os: string; arch: string; node: string };
  provenance: "internal-fixture";
  publicEvidence: "declared";
  thirdPartyAuthorVerified: false;
  scope: "scenario-sdk-matrix";
  coverage: "complete" | "partial";
  overallObjectiveComplete: false;
  foundation?: FoundationSelection;
  cases: ScenarioSdkCase[];
  limitations: string[];
  status: "passed" | "failed";
}
export function runScenarioSdkConformance(options?: {
  foundation?: "builtin" | "independent";
  nodePath?: string;
  caseIds?: readonly string[];
  onFailure?: (error: unknown, id: string) => void;
}): Promise<ScenarioSdkReport>;
