import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, open } from "node:fs/promises";
import path from "node:path";
import { copyPanelLayout, panelDenied, type PanelRect } from "@plumsjs/sdk";

export interface WorkspaceViewSelection {
  id: string;
  componentId: string;
  digest: string;
  panelId?: string;
  requirementId?: string;
  visible: boolean;
  rect: PanelRect;
}
export interface WorkspaceLayout {
  version: 1;
  componentId: string;
  digest: string;
  root: PanelRect;
  views: WorkspaceViewSelection[];
}
const rect = (r: PanelRect): PanelRect => ({
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height,
});
/** Only layout selectors are saved. Handles, tasks, grants and business values never enter this file. */
export function copyWorkspaceLayout(input: WorkspaceLayout): WorkspaceLayout {
  const value = structuredClone(input);
  if (
    !value ||
    value.version !== 1 ||
    typeof value.componentId !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.digest) ||
    !Array.isArray(value.views) ||
    value.views.length > 8
  )
    panelDenied("WORKSPACE_INVALID");
  const ids = new Set<string>();
  const views = value.views.map((v) => {
    if (
      !v ||
      typeof v.id !== "string" ||
      v.id.length > 160 ||
      ids.has(v.id) ||
      typeof v.componentId !== "string" ||
      !/^[a-f0-9]{64}$/.test(v.digest) ||
      typeof v.visible !== "boolean" ||
      (v.panelId !== undefined &&
        (typeof v.panelId !== "string" || typeof v.requirementId !== "string"))
    )
      panelDenied("WORKSPACE_INVALID");
    ids.add(v.id);
    copyPanelLayout({ root: v.rect, panels: [] });
    return {
      id: v.id,
      componentId: v.componentId,
      digest: v.digest,
      visible: v.visible,
      rect: rect(v.rect),
      ...(v.panelId !== undefined
        ? { panelId: v.panelId, requirementId: v.requirementId }
        : {}),
    };
  });
  copyPanelLayout({
    root: value.root,
    panels: views
      .filter((v) => v.visible)
      .map((v) => ({ ...v.rect, handle: v.id })),
  });
  return {
    version: 1,
    componentId: value.componentId,
    digest: value.digest,
    root: rect(value.root),
    views,
  };
}
export class WorkspaceLayouts {
  constructor(private directory: string) {}
  private file(agentId: string, componentId: string) {
    const key = createHash("sha256")
      .update(JSON.stringify([agentId, componentId]))
      .digest("hex");
    return path.join(this.directory, `${key}.json`);
  }
  async read(
    agentId: string,
    componentId: string,
  ): Promise<{ layout: WorkspaceLayout | null; diagnostic?: string }> {
    try {
      const text = await readFile(this.file(agentId, componentId), "utf8");
      if (Buffer.byteLength(text) > 32768) throw Error();
      const layout = copyWorkspaceLayout(JSON.parse(text));
      if (layout.componentId !== componentId) throw Error();
      return { layout };
    } catch (e) {
      return {
        layout: null,
        ...((e as NodeJS.ErrnoException).code === "ENOENT"
          ? {}
          : { diagnostic: "LAYOUT_INVALID" }),
      };
    }
  }
  async save(agentId: string, input: WorkspaceLayout) {
    const layout = copyWorkspaceLayout(input);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = this.file(agentId, layout.componentId),
      temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const writer = await open(temporary, "wx", 0o600);
      try {
        await writer.writeFile(JSON.stringify(layout));
        await writer.sync();
      } finally {
        await writer.close();
      }
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
