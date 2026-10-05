import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { ManagerProvider } from "./state/ManagerStore.js";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";

createRoot(document.getElementById("root")!).render(
  <ManagerProvider>
    <App />
  </ManagerProvider>,
);
