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
  /** Runs an action and shows how it ended, without marking anything busy. */
  async function report(action: () => Promise<void>) {
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
    }
  }
  /** Runs an action the open form waits for; `busy` holds it until it ends. */
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await report(action);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, notice, setError, setNotice, run, report };
}
