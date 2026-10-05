import { createHash } from "node:crypto";
import {
  PlumsError,
  IMPORT_INVALID,
  SETTINGS_INVALID,
  type Core,
} from "@plums/core";
import type { AgentRecord } from "./host.js";
import { missingRequiredSettings } from "@plums/sdk/settings";
import { connectionAccess, grantConnectionAccess } from "./connection-service.js";
export async function enablePlan(core: Core, record: AgentRecord) {
  const installed = await core.listInstalled(),
    order: string[] = [],
    visiting = new Set<string>(),
    done = new Set<string>();
  const visit = async (id: string) => {
    if (done.has(id)) return;
    if (visiting.has(id))
      throw new PlumsError({
        code: IMPORT_INVALID,
        message: "组件依赖不能循环。",
      });
    if (!installed.some((p) => p.id === id))
      throw new PlumsError({ code: IMPORT_INVALID, message: "缺少所需组件。" });
    visiting.add(id);
    const { manifest } = await core.getPackage(id);
    for (const d of manifest.dependencies) if (!d.optional) await visit(d.id);
    visiting.delete(id);
    done.add(id);
    order.push(id);
  };
  if (record.agent.startup) await visit(record.agent.startup);
  if (record.characterId) await visit(record.characterId);
  for (const p of installed) await visit(p.id);
  const entries = [],
    missing = [];
  let source = JSON.stringify({
    startup: record.agent.startup,
    characterId: record.characterId,
  });
  for (const id of order) {
    const detail = await core.getPackage(id),
      settings = await core.describeSettings(id);
    const access = await connectionAccess(core, id);
    source += JSON.stringify(detail);
    source += JSON.stringify(access);
    const fields = missingRequiredSettings(settings);
    if (fields.length)
      missing.push({ packageId: id, name: detail.manifest.name, fields });
    entries.push({
      packageId: id,
      name: detail.manifest.name,
      enabled: detail.installed.enabled,
      permissions: detail.manifest.permissions,
      needsApproval: !detail.installed.enabled || access.needsApproval,
      serviceTargets: access.serviceTargets,
    });
  }
  return {
    fingerprint: createHash("sha256").update(source).digest("hex"),
    entries,
    missing,
  };
}
export async function enablePrepared(
  core: Core,
  record: AgentRecord,
  fingerprint: string,
) {
  const plan = await enablePlan(core, record);
  if (plan.fingerprint !== fingerprint)
    throw new PlumsError({
      code: IMPORT_INVALID,
      message: "组件状态已变化，请重新查看权限并启用。",
    });
  if (plan.missing.length)
    throw new PlumsError({
      code: SETTINGS_INVALID,
      message: "请先填写所需配置。",
      path: "/settings",
    });
  const changed: string[] = [];
  try {
    for (const p of plan.entries)
      if (!p.enabled) {
        await core.grantConsent(p.packageId);
        await core.enable(p.packageId);
        changed.push(p.packageId);
      }
    for (const p of plan.entries) await grantConnectionAccess(core, p.packageId);
  } catch (e) {
    for (const id of changed.reverse()) await core.disable(id);
    throw e;
  }
}
