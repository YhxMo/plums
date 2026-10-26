import { useEffect, useEffectEvent } from "react";
import { appleKeyboard } from "@/components/keyboard";
import type { Runtime } from "./runtime";
import { commandOf, isAppCommand, type AppCommand } from "./app-commands";
import { errorMessage } from "./messages";

/**
 * Delivers the application's menu commands: from the native menu in the app,
 * from the same keys in the browser preview. Both end in `run`.
 */
export function useAppCommands(
  runtime: Runtime,
  run: (command: AppCommand) => void,
  fail: (message: string) => void,
) {
  const onCommand = useEffectEvent(run);
  const onFailure = useEffectEvent(fail);
  useEffect(() => {
    if (runtime.adapter.kind === "native") {
      // The system owns the keys; only the menu's events arrive.
      let stop: (() => void) | undefined;
      let stopped = false;
      runtime.adapter
        .onCommand((id) => {
          if (isAppCommand(id)) onCommand(id);
        })
        .then((release) => (stopped ? release() : (stop = release)))
        .catch((reason) =>
          onFailure(`菜单命令不可用：${errorMessage(reason)}`),
        );
      return () => {
        stopped = true;
        stop?.();
      };
    }
    const mac = appleKeyboard();
    const press = (event: KeyboardEvent) => {
      const command = commandOf(event, mac);
      if (!command) return;
      event.preventDefault();
      onCommand(command);
    };
    window.addEventListener("keydown", press);
    return () => window.removeEventListener("keydown", press);
  }, [runtime]);
}
