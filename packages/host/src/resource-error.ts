import { CAPABILITY_FAILED, PlumsError } from "@plumsjs/core";
import type { CommonErrorCode, CommonExecutionState } from "@plumsjs/sdk";
export function resourceFailure(
  reason: CommonErrorCode,
  callId?: string,
  executionState: CommonExecutionState = "not_started",
  phase = "authorization",
): PlumsError {
  return new PlumsError({
    code: CAPABILITY_FAILED,
    message: "资源请求未能完成，请检查当前范围或资源版本。",
    details: { reason, ...(callId ? { callId } : {}), executionState, phase },
  });
}
