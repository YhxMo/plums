import { createRoot } from "react-dom/client";
import { App } from "./App";
import { refuseStrayFileDrops } from "./shell/file-drops";
import "./app.css";

document.documentElement.dataset.theme = matchMedia(
  "(prefers-color-scheme: dark)",
).matches
  ? "dark"
  : "light";

refuseStrayFileDrops(window);

createRoot(document.getElementById("root")!).render(<App />);
