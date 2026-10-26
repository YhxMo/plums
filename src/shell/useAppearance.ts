import { useEffect, useLayoutEffect, useState } from "react";
import { applyTheme } from "@modules/shell/theme";
import type { Appearance as Colour } from "@modules/sdk";
import { useMediaQuery } from "@/components/useMediaQuery";
import type { Runtime } from "./runtime";
import type { ShellOperations } from "./useOperations";
import { errorMessage } from "./messages";

/** What the person chose: a fixed colour, or whatever the system uses. */
export type AppearancePreference = "system" | Colour;

export function useAppearance(runtime: Runtime, operations: ShellOperations) {
  const [preference, setPreference] = useState<AppearancePreference>(
    runtime.initial.theme,
  );
  const [themeId, setThemeId] = useState(runtime.initial.themeId);
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const themes = runtime.host.themes();
  const currentTheme = themes.find((entry) => entry.id === themeId);
  const chosen =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;
  // A theme contribution brings its own colour scheme, which the window takes too.
  const selected: AppearancePreference = currentTheme?.appearance ?? preference;
  const { setError } = operations;
  useLayoutEffect(() => {
    applyTheme(document.documentElement, chosen, currentTheme);
    return () => applyTheme(document.documentElement, chosen);
  }, [chosen, currentTheme]);
  useEffect(() => {
    if (runtime.adapter.kind === "native")
      void runtime.adapter
        .setTheme(selected)
        .catch((reason) =>
          setError(`窗口外观更新失败：${errorMessage(reason)}`),
        );
  }, [runtime, selected, setError]);
  // Write only appearance fields; a queued save must not carry another domain's stale value.
  async function selectAppearance(next: AppearancePreference) {
    await runtime.save({ theme: next, themeId: null });
    setPreference(next);
    setThemeId(null);
  }
  async function selectTheme(id: string | null) {
    await runtime.save({ themeId: id });
    setThemeId(id);
  }
  return {
    selected,
    themeId,
    themes,
    currentTheme,
    selectAppearance,
    selectTheme,
  };
}

export type Appearance = ReturnType<typeof useAppearance>;
