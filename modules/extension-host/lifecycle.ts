import { ContractError } from "../sdk/errors";

/** Host-boundary error with the stable `host.invalid` code. */
export const hostError = (message: string) =>
  new ContractError("host.invalid", "host", message);

/** Bound a lifecycle promise; the timeout message distinguishes activation from cleanup. */
export async function within<T>(
  promise: Promise<T>,
  timeout: number,
  timeoutMessage = "cleanup timeout; restart required",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(hostError(timeoutMessage)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

/** Why a desired extension is not active yet; diagnostics read this, not text. */
export type WaitReason =
  | { kind: "configuration"; message: string }
  | { kind: "capability-unavailable"; capability: string }
  | { kind: "permission"; capability: string }
  | { kind: "dependency"; service: string; version: number }
  | { kind: "cycle" };

/** Developer-facing text kept in `inspect().error` for logs and older callers. */
export function describeWait(wait: WaitReason) {
  switch (wait.kind) {
    case "configuration":
      return `Configuration invalid: ${wait.message}`;
    case "capability-unavailable":
      return `Capability unavailable: ${wait.capability}`;
    case "permission":
      return `Permission required: ${wait.capability}`;
    case "dependency":
      return `Dependency unavailable: ${wait.service}@${wait.version}`;
    case "cycle":
      return "Dependency cycle";
  }
}
