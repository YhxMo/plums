import type { Confirm } from "@plums/core";

export async function confirmOnce(
  confirm: Confirm,
  request: Parameters<Confirm["ask"]>[0],
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return false;
  const combined = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  let cancel!: () => void;
  const aborted = new Promise<boolean>((resolve) => {
    cancel = () => resolve(false);
    combined.addEventListener("abort", cancel, { once: true });
  });
  try {
    return (
      (await Promise.race([
        Promise.resolve()
          .then(() => confirm.ask(request))
          .catch(() => false),
        aborted,
      ])) === true && !combined.aborted
    );
  } finally {
    combined.removeEventListener("abort", cancel);
  }
}
