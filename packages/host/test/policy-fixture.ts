import { createArchive, type ManifestV2 } from "@plums/core";
import type { DesktopHost } from "../src/host.js";
export const policyBodies: Record<string, string> = {
  allow: `return decision('allow');`,
  deny: `return decision(c.category==='tool'?'allow':'deny');`,
  confirm: `return decision(c.category==='tool'?'allow':'confirm');`,
  custom: `return decision(c.category==='tool'||c.intent.path==='allowed.txt'?'allow':'deny');`,
};
export async function addPolicy(
  host: DesktopHost,
  agentId: string,
  id: string,
  body = policyBodies[id]!,
) {
  const manifest: ManifestV2 = {
    formatVersion: "2.0",
    id: "policy-" + id,
    kind: "extension",
    name: "Policy " + id,
    version: "1.0.0",
    description: "Deterministic internal platform policy fixture",
    dependencies: [],
    permissions: [],
    payload: {
      plumsDesktop: {
        sdkVersion: "2",
        runtime: "main.js",
        common: {
          commonVersion: "1.0",
          features: ["policy-v1"],
          runtime: "isolate",
          policy: { provideId: "decision" },
        },
        contributes: { tools: [{ name: "assess", title: "Assess" }] },
        protocols: {
          provides: [
            {
              id: "decision",
              protocol: "org.plums.policy",
              version: "1.0.0",
              contribution: { kind: "tools", name: "assess" },
            },
          ],
        },
      },
    },
  };
  const preview = (await host.preview(
    await createArchive({
      "manifest.json": Buffer.from(JSON.stringify(manifest)),
      "main.js": Buffer.from(
        `export function activate(s){s.register('tools','assess',async v=>{const c=v.input;const decision=decision=>({assessmentId:c.assessmentId,operationFingerprint:c.operationFingerprint,decision});${body}});}`,
      ),
    }),
  )) as { token: string };
  const artifact = await host.importLibrary(preview.token);
  await host.addLibraryComponent(agentId, artifact.digest);
  await host.enable(agentId, manifest.id);
  return artifact;
}
export async function select(host: DesktopHost, id: string, policy: string) {
  const plan = await host.policyPlan(id);
  await host.selectPolicy(
    id,
    plan.fingerprint,
    "policy-" + policy,
    "decision",
    policy,
  );
}
export async function grant(
  host: DesktopHost,
  id: string,
  filter = (_row: { category: string; target: string }) => true,
) {
  const plan = await host.policyPlan(id);
  await host.grantPolicyScope(
    id,
    plan.fingerprint,
    900_000,
    plan.available.filter(filter),
  );
}
