import {
  createPageRouter,
  type ExtensionDefinition,
  type StoredState,
} from "@modules/sdk";
import type { Transformer } from "@extensions/contracts";
import { TextWorkbenchStore } from "./store";
import { mountWorkbench, workbenchPages } from "./view";

/** Sample business/UI extension. No Host imports or private shell callbacks. */
export const textWorkbench: ExtensionDefinition = {
  manifest: {
    id: "ui.workbench-board",
    version: "0.1.0",
    apiVersion: 1,
    requires: { "text.transform": 1 },
    provides: { "text-workbench.pages": 1 },
    capabilities: ["state.read", "state.write"],
  },
  async activate(ctx) {
    const transformer = ctx.use<Transformer>("text.transform");
    const saved = (await ctx.platform("state.read")) as StoredState | null;
    let revision = saved?.revision ?? 0;
    const store = new TextWorkbenchStore(
      saved?.value,
      transformer.name,
      (input, signal) => ctx.task(() => transformer.transform(input, signal)),
      async (value) => {
        const receipt = (await ctx.platform("state.write", {
          revision,
          value,
        })) as StoredState;
        revision = receipt.revision;
      },
    );
    ctx.onDispose(() => store.close());
    const router = createPageRouter({
      signal: ctx.signal,
      initialRoute: ctx.shell.readPage("text-workbench") ?? "list",
      save: (route) => ctx.shell.savePage("text-workbench", route),
      beforeLeave: () => store.quiesce(),
    });
    ctx.onDispose(() => router.close());
    for (const [route, node] of Object.entries(
      workbenchPages(store, router, ctx, transformer.name),
    )) {
      await router.register({
        id: `text-workbench.${route}`,
        route,
        label: route,
        priority: 0,
        node,
      });
    }
    // Another extension may declare requires: {"text-workbench.pages": 1},
    // register a page/node, and await its removal in ctx.onDispose.
    ctx.provide("text-workbench.pages", 1, { register: router.register });
    ctx.view({
      id: "text-workbench",
      label: "文本处理工作台",
      beforeLeave: () => store.quiesce(),
      mount: (root) => mountWorkbench(root, store, router, ctx),
    });
  },
};
