import { useState } from "react";
import { ActionToast } from "@/components/Toast";
import type { AgentModals } from "./useAgentModals";

/**
 * The workspace's notices, one of which may offer 撤销: the toast it
 * shows, and the way to put something on it that can be taken back.
 */
export function useUndoNotice(
  modals: Pick<
    AgentModals,
    "error" | "notice" | "setError" | "setNotice" | "act"
  >,
) {
  const { error, notice, setError, setNotice, act } = modals;
  // What the current notice can take back, if anything.
  const [undoable, setUndoable] = useState<{
    notice: string;
    undo: () => Promise<void>;
  } | null>(null);
  return {
    /** Says `text`, with 撤销 running `undo` while the notice shows. */
    offer(text: string, undo: () => Promise<void>) {
      setNotice(text);
      setUndoable({ notice: text, undo });
    },
    toast: (
      <ActionToast
        error={error}
        notice={notice}
        action={
          undoable && notice === undoable.notice
            ? {
                label: "撤销",
                onClick: () => {
                  setUndoable(null);
                  void act(async () => {
                    await undoable.undo();
                    setNotice("已恢复");
                  });
                },
              }
            : undefined
        }
        onDone={() => {
          setError("");
          setNotice("");
          setUndoable(null);
        }}
      />
    ),
  };
}
