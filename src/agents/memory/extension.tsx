import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { memoryExtension } from "@modules/agents/memory/extension";
import { LayerContainer } from "@/components/ui/layer";

// The page loads when its dialog first opens, not at startup.
const MemoryPage = lazy(() =>
  import("./MemoryPage").then((module) => ({ default: module.MemoryPage })),
);

/** The built-in memory with its React page. */
export const memoryExtensionWithPage = () =>
  memoryExtension({
    mountPage(container, api) {
      const element = document.createElement("div");
      container.append(element);
      const root = createRoot(element);
      // Its own React root: popups stay inside the page, and so inside the
      // dialog that shows it.
      root.render(
        <MotionConfig reducedMotion="user">
          <LayerContainer value={element}>
            <Suspense fallback={null}>
              <MemoryPage api={api} />
            </Suspense>
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
