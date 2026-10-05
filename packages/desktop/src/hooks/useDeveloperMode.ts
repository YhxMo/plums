import { useState } from "react";
export function useDeveloperMode() {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem("plums.developerMode") === "true";
    } catch {
      return false;
    }
  });
  return [
    enabled,
    (value: boolean) => {
      setEnabled(value);
      try {
        localStorage.setItem("plums.developerMode", String(value));
      } catch {}
    },
  ] as const;
}
