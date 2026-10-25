import { useEffect, useEffectEvent, useState } from "react";
import type { Agent } from "@modules/agents/contract";
import { writeBundle } from "@modules/agents/agent-bundle";
import { bytesToBase64 } from "@modules/agents/card-png";
import type { BundleExtension } from "@modules/sdk";
import { DialogActions, DialogBody } from "@/components/Dialog";
import { Button } from "@/components/ui/button";
import { fileName, roleCardPng } from "./cardFile";

/**
 * Packs an Agent with the extensions it is made of into one `.plums` file.
 * Passing on third-party code is redistribution, so those extensions are
 * listed first with their author and licence; built-in ones go by name only.
 */
export function ExportBundle({
  agent,
  parts,
  busy,
  leave,
  onBundle,
  onExport,
}: {
  agent: Agent;
  /** IDs of the extensions the Agent is made of. */
  parts: string[];
  busy: boolean;
  leave: React.ReactNode;
  onBundle: (ids: string[]) => Promise<BundleExtension[]>;
  /** Saves the file; resolves after the person has chosen where. */
  onExport: (name: string, data: string) => void;
}) {
  const [found, setFound] = useState<BundleExtension[] | Error>();
  const read = useEffectEvent((ids: string[]) => onBundle(ids));
  useEffect(() => {
    let current = true;
    read(parts).then(
      (list) => current && setFound(list),
      (error: Error) => current && setFound(error),
    );
    return () => {
      current = false;
    };
  }, [parts]);
  if (!found)
    return (
      <DialogBody>
        <p className="text-muted-foreground">正在读取扩展…</p>
      </DialogBody>
    );
  if (found instanceof Error)
    return (
      <DialogBody>
        <p className="text-destructive">{found.message}</p>
      </DialogBody>
    );
  const packed = found.filter((entry) => entry.package);
  const builtIn = found.filter((entry) => !entry.package);
  return (
    <>
      <DialogBody className="gap-[18px]">
        {packed.length > 0 ? (
          <section className="grid gap-2">
            <h3 className="text-sm font-medium">一并打包的扩展</h3>
            <p className="text-xs text-muted-foreground">
              它们的代码会随文件交给别人，请确认作者允许转发。
            </p>
            <ul
              aria-label="一并打包的扩展"
              className="divide-y rounded-lg border"
            >
              {packed.map((entry) => (
                <li key={entry.id} className="grid gap-0.5 px-3 py-2.5">
                  <span>{entry.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {entry.author ?? "未注明作者"}，
                    {entry.license ? `许可证 ${entry.license}` : "未注明许可证"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="text-muted-foreground">
            它只用到内置扩展，导入的一方会用自己应用里的。
          </p>
        )}
        {builtIn.length > 0 && packed.length > 0 && (
          <p className="text-xs text-muted-foreground">
            内置扩展只记名字，导入的一方用自己应用里的：
            {builtIn.map((entry) => entry.label).join("、")}。
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          不包含记忆、会话、模型选择和密钥。
        </p>
      </DialogBody>
      <DialogActions>
        {leave}
        <Button
          type="button"
          disabled={busy}
          onClick={() =>
            void roleCardPng(agent).then((card) =>
              onExport(
                fileName(agent.name, ".plums"),
                bytesToBase64(
                  writeBundle({
                    card,
                    extensions: found,
                    off: (agent.off ?? []).filter((id) => parts.includes(id)),
                  }),
                ),
              ),
            )
          }
        >
          导出
        </Button>
      </DialogActions>
    </>
  );
}
