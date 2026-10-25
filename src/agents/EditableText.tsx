import { useState, type ReactNode } from "react";
import { PencilIcon } from "lucide-react";
import { cn } from "cn";
import { Tooltip } from "@/components/Tooltip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * A text edited where it is shown: the pencil comes out under a pointer
 * (touch always shows it), and a failed save keeps what was typed.
 */
export function EditableText({
  label,
  value,
  empty,
  placeholder,
  maxLength,
  disabled,
  clamp,
  onSave,
}: {
  /** Names the text box and, as 编辑{label}, its pencil. */
  label: string;
  value: string;
  /** Shown in place of an empty value. */
  empty: ReactNode;
  placeholder: string;
  maxLength: number;
  disabled?: boolean;
  /** Shows only the first lines until edited. */
  clamp?: boolean;
  /** Resolves true once saved. */
  onSave: (value: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  if (editing === null)
    return (
      <div className="group/editable flex items-start gap-1">
        <p
          className={cn(
            "min-w-0 flex-1 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/85 wrap-anywhere",
            clamp && "line-clamp-6",
          )}
        >
          {value || <span className="text-muted-foreground">{empty}</span>}
        </p>
        <Tooltip label={`编辑${label}`}>
          <Button
            variant="ghost"
            size="icon-xs"
            className="-mt-0.5 shrink-0 text-muted-foreground transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover/editable:opacity-100 pointer-fine:group-focus-within/editable:opacity-100"
            aria-label={`编辑${label}`}
            disabled={disabled}
            onClick={() => setEditing(value)}
          >
            <PencilIcon />
          </Button>
        </Tooltip>
      </div>
    );
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(editing).then((saved) => {
          if (saved) setEditing(null);
        });
      }}
    >
      <Textarea
        aria-label={label}
        autoFocus
        value={editing}
        maxLength={maxLength}
        className="min-h-28 text-[13px]"
        placeholder={placeholder}
        onChange={(e) => setEditing(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEditing(null)}
        >
          取消
        </Button>
        <Button type="submit" size="sm" disabled={disabled}>
          保存
        </Button>
      </div>
    </form>
  );
}
