import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./touch.css";

document.documentElement.dataset.theme = matchMedia(
  "(prefers-color-scheme: dark)",
).matches
  ? "dark"
  : "light";

createRoot(document.getElementById("root")!).render(<App />);
