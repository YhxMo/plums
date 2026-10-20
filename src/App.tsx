import { useEffect, useState } from "react";
import { boot } from "./application";
import type { Runtime } from "./shell/runtime";
import { StartupScreen } from "./shell/StartupScreen";
import { Workbench } from "./shell/Workbench";
import { Toaster } from "./components/ui/sonner";

type Startup =
  | { status: "loading" }
  | { status: "ready"; runtime: Runtime }
  | { status: "failed"; reason: unknown };

export function App() {
  const [startup, setStartup] = useState<Startup>({ status: "loading" });
  useEffect(() => {
    let active = true;
    void boot().then(
      (runtime) => {
        if (active) setStartup({ status: "ready", runtime });
      },
      (reason) => {
        if (active) setStartup({ status: "failed", reason });
      },
    );
    return () => {
      active = false;
    };
  }, []);
  if (startup.status === "ready")
    return (
      <>
        <Workbench runtime={startup.runtime} />
        {/* Toasts raised outside any dialog; each dialog brings its own. */}
        <Toaster position="top-center" />
      </>
    );
  return (
    <StartupScreen
      key={startup.status}
      reason={startup.status === "failed" ? startup.reason : undefined}
    />
  );
}
