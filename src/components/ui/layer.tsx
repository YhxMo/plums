import { createContext, useContext } from "react";

/**
 * Where popups (tooltips, selects, menus) portal to. A modal dialog provides
 * its content element so popups opened inside stay within it: part of the
 * modal's accessibility tree and under its focus trap.
 */
export const LayerContainer = createContext<HTMLElement | null>(null);

export const useLayerContainer = () => useContext(LayerContainer) ?? undefined;
