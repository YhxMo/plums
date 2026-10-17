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
