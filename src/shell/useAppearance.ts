import { useEffect, useLayoutEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { applyTheme } from "../../modules/shell/theme";
import type { Runtime } from "./runtime";
import type { ShellOperations } from "./useOperations";
import { errorMessage } from "./messages";

export function useAppearance(runtime: Runtime, operations: ShellOperations) {
  const [theme, setTheme] = useState(runtime.theme);
  const [themeId, setThemeId] = useState(runtime.themeId);
  const themes = runtime.host.themes();
  const currentTheme = themes.find((entry) => entry.id === themeId);
  const appearance = currentTheme?.appearance ?? theme;
  const { setError } = operations;
  useLayoutEffect(() => {
    applyTheme(document.documentElement, theme, currentTheme);
    return () => applyTheme(document.documentElement, theme);
  }, [theme, currentTheme]);
  useEffect(() => {
    if (runtime.adapter.kind === "native")
      void invoke("shell_set_theme", { theme: appearance }).catch((reason) =>
        setError(`窗口外观更新失败：${errorMessage(reason)}`),
      );
  }, [runtime, appearance, setError]);
  async function toggleTheme(layout: string) {
    const next = appearance === "light" ? "dark" : "light";
    await runtime.save({ layout, theme: next, themeId: null });
    setTheme(next);
    setThemeId(null);
  }
  async function selectTheme(id: string | null) {
    await runtime.save({ themeId: id });
    setThemeId(id);
  }
  return {
    theme,
    themeId,
    themes,
    currentTheme,
    appearance,
    toggleTheme,
    selectTheme,
  };
}

export type Appearance = ReturnType<typeof useAppearance>;
