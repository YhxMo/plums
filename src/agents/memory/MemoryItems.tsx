import { useState } from "react";
import { PencilIcon, Trash2Icon } from "lucide-react";
import type { MemoryItem } from "@modules/agents/memory/contract";
import {
  MAX_ITEM_TEXT,
  expired,
  formatTime,
} from "@modules/agents/memory/items";
import { Tooltip } from "@/components/Tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type ItemFields = Pick<MemoryItem, "text" | "at" | "until">;

const pad = (n: number) => String(n).padStart(2, "0");
/** A `datetime-local` value for `ms`, in this device's time zone. */
const toInput = (ms?: number) => {
  if (ms === undefined) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromInput = (value: string) =>
  value ? new Date(value).getTime() : undefined;
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** When an item happens and until when it holds, in words. */
export function itemTime(item: ItemFields, now: number) {
  const parts = [
    item.at !== undefined && formatTime(item.at, now, zone()),
    item.until !== undefined &&
      item.until !== item.at &&
      `到 ${formatTime(item.until, now, zone())}`,
  ].filter(Boolean);
  return parts.join(" ");
}

/** Text and, optionally, when it happens and until when it holds. */
export function ItemForm({
  item,
  submit,
  busy,
  onSave,
  onCancel,
}: {
  item?: ItemFields;
  submit: string;
  busy: boolean;
  /** Resolves true once saved, which clears a new item's form. */
  onSave: (fields: ItemFields) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(item?.text ?? "");
  const [at, setAt] = useState(toInput(item?.at));
  const [until, setUntil] = useState(toInput(item?.until));
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({ text, at: fromInput(at), until: fromInput(until) }).then(
          (saved) => {
            if (saved && !item) {
              setText("");
              setAt("");
              setUntil("");
            }
          },
        );
      }}
    >
      <Textarea
        aria-label={item ? "记忆内容" : "新的记忆"}
        autoFocus={!!item}
        value={text}
        maxLength={MAX_ITEM_TEXT}
        className="min-h-16 text-sm"
        placeholder="例如：对花生过敏；每周三下午有吉他课"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-2 max-form:grid-cols-1">
        <label className="grid gap-1 text-xs text-muted-foreground">
          时间（可选）
          <Input
            type="datetime-local"
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          到期（可选，过后不再告诉 Agent）
          <Input
            type="datetime-local"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            取消
          </Button>
        )}
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          {submit}
        </Button>
      </div>
    </form>
  );
}

/** Items as a list, each editable in place and removable. */
export function MemoryItems({
  label,
  items,
  now,
  busy,
  onUpdate,
  onRemove,
}: {
  label: string;
  items: readonly MemoryItem[];
  now: number;
  busy: boolean;
  onUpdate: (id: string, fields: ItemFields) => Promise<boolean>;
  onRemove: (item: MemoryItem) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <ul
      aria-label={label}
      className="divide-y overflow-hidden rounded-lg border bg-card"
    >
      {items.map((item) =>
        editing === item.id ? (
          <li key={item.id} className="p-3">
            <ItemForm
              item={item}
              submit="保存"
              busy={busy}
              onCancel={() => setEditing(null)}
              onSave={async (fields) => {
                const saved = await onUpdate(item.id, fields);
                if (saved) setEditing(null);
                return saved;
              }}
            />
          </li>
        ) : (
          <li
            key={item.id}
            className="group/item flex items-start gap-2 px-3 py-2.5"
          >
            <div className="grid min-w-0 flex-1 gap-1">
              <p className="text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere">
                {item.text}
              </p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {itemTime(item, now) && <span>{itemTime(item, now)}</span>}
                {expired(item, now) && (
                  <Badge variant="secondary" className="text-muted-foreground">
                    已过期
                  </Badge>
                )}
                {item.by === "conversation" && <span>从对话中记下</span>}
              </div>
            </div>
            <div className="flex shrink-0 gap-0.5 transition-opacity pointer-fine:opacity-0 pointer-fine:group-focus-within/item:opacity-100 pointer-fine:group-hover/item:opacity-100">
              <Tooltip label="编辑">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`编辑：${item.text}`}
                  disabled={busy}
                  onClick={() => setEditing(item.id)}
                >
                  <PencilIcon />
                </Button>
              </Tooltip>
              <Tooltip label="删除">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`删除：${item.text}`}
                  disabled={busy}
                  onClick={() => onRemove(item)}
                >
                  <Trash2Icon />
                </Button>
              </Tooltip>
            </div>
          </li>
        ),
      )}
    </ul>
  );
}
