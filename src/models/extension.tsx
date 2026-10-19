import { createRoot } from "react-dom/client";
import { modelConnector } from "../../modules/models/extension";
import { ModelConnections } from "./ModelConnections";

/** The built-in model connector with its React connection page. */
export const modelConnectorWithPage = () =>
  modelConnector({
    mountPage(container, api) {
      const element = document.createElement("div");
      container.append(element);
      const root = createRoot(element);
      root.render(<ModelConnections api={api} />);
      return async () => {
        element.remove();
        await Promise.resolve();
        root.unmount();
      };
    },
  });
