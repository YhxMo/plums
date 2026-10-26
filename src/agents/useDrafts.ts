import { useCallback, useRef, useState } from "react";
import type { AgentProvider, Attachment } from "@modules/agents/contract";
import { attachmentProblem } from "@modules/agents/attachments";
import { toAttachment } from "./attachmentFile";
import type { AgentModals } from "./useAgentModals";

type Drafts = Record<string, string>;

/**
 * What waits to be sent in each conversation, keyed `agent:session`: the
 * text and the files, which survive switching conversations and widths.
 * Sending clears them and puts them back when the send fails.
 */
export function useDrafts({
  api,
  report,
  setError,
}: {
  api: Pick<AgentProvider, "send">;
  report: AgentModals["report"];
  setError: (text: string) => void;
}) {
  const [drafts, setDrafts] = useState<Drafts>({});
  const [files, setFiles] = useState<Record<string, Attachment[]>>({});
  const filesNow = useRef(files);
  filesNow.current = files;
  async function addFiles(key: string, added: File[]) {
    const read: Attachment[] = [];
    for (const file of added) {
      try {
        read.push(await toAttachment(file));
      } catch (error) {
        setError(error instanceof Error ? error.message : "无法添加文件。");
      }
    }
    if (!read.length) return;
    const next = [...(filesNow.current[key] ?? []), ...read];
    const problem = attachmentProblem(next);
    if (problem) setError(problem);
    else setFiles((current) => ({ ...current, [key]: next }));
  }
  // Stable for the window's drop target, which outlives a render; it
  // always adds to the latest files.
  const addFilesNow = useRef(addFiles);
  addFilesNow.current = addFiles;
  const add = useCallback(
    (key: string, added: readonly File[]) =>
      void addFilesNow.current(key, [...added]),
    [],
  );
  return {
    drafts,
    setDrafts,
    text: (key: string) => drafts[key] ?? "",
    setText: (key: string, value: string) =>
      setDrafts((d) => ({ ...d, [key]: value })),
    files: (key: string) => files[key] ?? [],
    addFiles: add,
    removeFile: (key: string, index: number) =>
      setFiles((f) => ({
        ...f,
        [key]: (f[key] ?? []).filter((_, i) => i !== index),
      })),
    send(key: string, agentId: string) {
      const input = drafts[key] ?? "";
      const attached = files[key] ?? [];
      // The sent text shows as a pending bubble; a failed send puts it
      // back unless the user has started a new draft.
      setDrafts((d) => ({ ...d, [key]: "" }));
      setFiles((f) => ({ ...f, [key]: [] }));
      // A reply can take minutes; dialogs need not wait for it.
      void report(async () => {
        try {
          await api.send(agentId, input, attached);
        } catch (error) {
          setDrafts((d) => (d[key] ? d : { ...d, [key]: input }));
          setFiles((f) => (f[key]?.length ? f : { ...f, [key]: attached }));
          throw error;
        }
      });
    },
  };
}
