import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { modelConnector } from "@modules/models/extension";
import { ModelConnections } from "./ModelConnections";
import { LayerContainer } from "@/components/ui/layer";

/** The built-in model connector with its React connection page. */
export const modelConnectorWithPage = () =>
  modelConnector({
    mountPage(container, api) {
      const element = document.createElement("div");
      container.append(element);
      const root = createRoot(element);
      // Its own React root: popups stay inside the page, and so inside the
      // dialog that shows it.
      root.render(
        <MotionConfig reducedMotion="user">
          <LayerContainer value={element}>
            <ModelConnections api={api} />
          </LayerContainer>
        </MotionConfig>,
      );
      return async () => {
        element.remove();
        await Promise.resolve();
        root.unmount();
      };
    },
  });
