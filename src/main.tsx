import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./mobile-theme.css";
import "./touch.css";

document.documentElement.dataset.theme = matchMedia(
  "(prefers-color-scheme: dark)",
).matches
  ? "dark"
  : "light";

// After a tap or click, focus moved by code (a closed dialog or menu returning
// to its opener) must not draw the keyboard ring, which WebKit would show.
const root = document.documentElement;
addEventListener("pointerdown", () => (root.dataset.input = "pointer"), true);
addEventListener("keydown", () => (root.dataset.input = "keyboard"), true);

createRoot(document.getElementById("root")!).render(<App />);
