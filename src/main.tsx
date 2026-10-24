import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { App } from "./App";
import { refuseStrayFileDrops } from "./shell/file-drops";
import "./app.css";

document.documentElement.dataset.theme = matchMedia(
  "(prefers-color-scheme: dark)",
).matches
  ? "dark"
  : "light";

refuseStrayFileDrops(window);

// Each React root honours the system's reduced-motion setting.
createRoot(document.getElementById("root")!).render(
  <MotionConfig reducedMotion="user">
    <App />
  </MotionConfig>,
);
