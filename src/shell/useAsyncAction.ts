import { useState } from "react";

const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

export function useAsyncAction({
  initialError = "",
  describeError = message,
  abortNotice,
}: {
  initialError?: string;
  describeError?: (reason: unknown) => string;
  abortNotice?: string;
} = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (reason) {
      if (
        abortNotice !== undefined &&
        reason instanceof Error &&
        reason.name === "AbortError"
      )
        setNotice(abortNotice);
      else setError(describeError(reason));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, notice, setError, setNotice, run };
}
