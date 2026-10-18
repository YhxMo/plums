import { platformRejection } from "../../modules/sdk";
import type { NativeCommands } from "./contract.generated";

export type StateErrorCode = NativeCommands["platform_call"]["error"]["code"];
const copy: Record<StateErrorCode, string> = {
  "invalid-owner": "状态所属者无效。",
  "unknown-capability": "平台能力不支持。",
  "permission-denied": "平台操作未获授权。",
  "grant-unavailable": "授权更新失败，请重新启动应用。",
  "grant-lock": "授权状态不可用，请重新启动应用。",
  "state-lock": "状态锁不可用，原数据已保留。",
  "state-too-large": "状态超过 64 KiB 实验上限，未保存。",
  "state-corrupt": "应用状态已损坏，原数据已保留。",
  "state-schema": "状态版本不支持或已损坏，原数据已保留。",
  "state-read": "状态读取失败，原数据已保留。",
  "missing-revision": "状态修订号无效，未保存。",
  "missing-value": "状态值无效，未保存。",
  "revision-limit": "状态修订号已达上限，未保存。",
  "revision-conflict": "状态已被其他操作更新，请重新加载应用后重试。",
  "state-directory": "状态目录不可用，原数据已保留。",
  "state-temporary": "状态临时文件不可用，原数据已保留。",
  "state-write": "状态写入失败，原数据已保留。",
  "state-sync": "状态已写入但未确认落盘，请重新加载应用后再修改。",
  serialization: "状态序列化失败，原数据已保留。",
};
export function isStateErrorCode(code: unknown): code is StateErrorCode {
  return typeof code === "string" && Object.hasOwn(copy, code);
}
export function stateRejection(code: StateErrorCode) {
  return Object.assign(platformRejection(copy[code]), { code });
}
/** A native write that may already be on disk; callers must not retry blindly. */
export function stateUncertain(code: StateErrorCode) {
  return Object.assign(new Error(copy[code]), {
    code,
    outcome: "unknown" as const,
  });
}
