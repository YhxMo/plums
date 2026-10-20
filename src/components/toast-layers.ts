import { create } from "zustand";

/**
 * Open dialogs, innermost last. A modal dialog hides the rest of the page
 * from assistive technology, so a toast raised while one is open goes to
 * the toaster inside it.
 */
export const useToastLayers = create<{
  layers: string[];
  push: (id: string) => void;
  remove: (id: string) => void;
}>((set) => ({
  layers: [],
  push: (id) => set(({ layers }) => ({ layers: [...layers, id] })),
  remove: (id) =>
    set(({ layers }) => ({ layers: layers.filter((layer) => layer !== id) })),
}));
