import { useState } from "react";
import { FileTextIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import type { Attachment } from "../../modules/agents/contract";
import { Dialog } from "../components/Dialog";

const source = (a: Extract<Attachment, { kind: "image" }>) =>
  `data:${a.mime};base64,${a.data}`;

/** Opens one attachment large: the picture, or the file's text. */
function Preview({
  attachment,
  onClose,
}: {
  attachment: Attachment;
  onClose: () => void;
}) {
  return (
    <Dialog title={attachment.name} onClose={onClose} className="max-w-3xl">
      {attachment.kind === "image" ? (
        <img
          src={source(attachment)}
          alt={attachment.name}
          className="mx-auto max-h-[70vh] max-w-full rounded-lg object-contain"
        />
      ) : (
        <pre className="max-h-[70vh] overflow-auto rounded-lg bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere">
          {attachment.text}
        </pre>
      )}
    </Dialog>
  );
}

function Thumb({ attachment }: { attachment: Attachment }) {
  return attachment.kind === "image" ? (
    <img
      src={source(attachment)}
      alt=""
      className="size-6 shrink-0 rounded-md object-cover"
    />
  ) : (
    <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
  );
}

/** The files waiting in the message box, each removable. */
export function DraftAttachments({
  attachments,
  disabled,
  onRemove,
}: {
  attachments: readonly Attachment[];
  disabled?: boolean;
  onRemove: (index: number) => void;
}) {
  return (
    <ul
      aria-label="待发送的附件"
      className="m-0 flex w-full list-none flex-wrap gap-1.5 p-0 px-2.5 pt-2.5"
    >
      {attachments.map((a, index) => (
        <li
          key={`${index}-${a.name}`}
          className="flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-lg bg-muted pr-0.5 pl-1.5 text-xs"
        >
          <Thumb attachment={a} />
          <span className="min-w-0 truncate">{a.name}</span>
          <button
            type="button"
            data-slot="attachment-action"
            disabled={disabled}
            aria-label={`移除 ${a.name}`}
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground max-md:size-8"
            onClick={() => onRemove(index)}
          >
            <XIcon className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** What a sent message carries, under its text: thumbnails and file tags. */
export function MessageAttachments({
  attachments,
  user,
}: {
  attachments: readonly Attachment[];
  user: boolean;
}) {
  const [open, setOpen] = useState<Attachment>();
  return (
    <>
      <ul
        aria-label="附件"
        className={cn(
          "m-0 flex max-w-[min(85%,640px)] list-none flex-wrap gap-1.5 p-0",
          user ? "justify-end" : "justify-start",
        )}
      >
        {attachments.map((a, index) => (
          <li key={`${index}-${a.name}`} className="min-w-0">
            <button
              type="button"
              data-slot="attachment-action"
              aria-label={`查看 ${a.name}`}
              className={cn(
                "flex min-w-0 items-center gap-1.5 overflow-hidden rounded-xl text-xs",
                a.kind === "image"
                  ? "w-fit max-w-48"
                  : "h-8 max-w-56 bg-card px-2.5 text-card-foreground",
              )}
              onClick={() => setOpen(a)}
            >
              {a.kind === "image" ? (
                <img
                  src={source(a)}
                  alt={a.name}
                  className="max-h-40 max-w-full rounded-xl object-cover"
                />
              ) : (
                <>
                  <Thumb attachment={a} />
                  <span className="truncate">{a.name}</span>
                </>
              )}
            </button>
          </li>
        ))}
      </ul>
      {open && <Preview attachment={open} onClose={() => setOpen(undefined)} />}
    </>
  );
}
