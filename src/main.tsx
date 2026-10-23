import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { App } from "./App";
import "./app.css";

document.documentElement.dataset.theme = matchMedia(
  "(prefers-color-scheme: dark)",
).matches
  ? "dark"
  : "light";

// Each React root honours the system's reduced-motion setting.
createRoot(document.getElementById("root")!).render(
  <MotionConfig reducedMotion="user">
    <App />
  </MotionConfig>,
);
