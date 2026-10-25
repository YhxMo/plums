import { useId, useState } from "react";
import { ClockIcon, PencilIcon, Trash2Icon } from "lucide-react";
import type { MemoryItem } from "@modules/agents/memory/contract";
import { MAX_ITEM_TEXT, formatTime } from "@modules/agents/memory/items";
import { InfoTip, Tooltip } from "@/components/Tooltip";
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

/**
 * Text and, optionally, when it happens and until when it holds. A new item
 * is one line, its times behind 设置时间; an item being edited shows all.
 */
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
  const [timed, setTimed] = useState(!!item);
  const untilId = useId();
  const times = (
    <div className="grid grid-cols-2 gap-2 max-form:grid-cols-1">
      <label className="grid gap-1 text-xs text-muted-foreground">
        时间
        <Input
          type="datetime-local"
          value={at}
          onChange={(e) => setAt(e.target.value)}
        />
      </label>
      <div className="grid gap-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <label htmlFor={untilId}>到期</label>
          <InfoTip label="到期" text="过了这个时间，就不再告诉 Agent。" />
        </span>
        <Input
          id={untilId}
          type="datetime-local"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
        />
      </div>
    </div>
  );
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
              setTimed(false);
            }
          },
        );
      }}
    >
      {item ? (
        <>
          <Textarea
            aria-label="记忆内容"
            autoFocus
            value={text}
            maxLength={MAX_ITEM_TEXT}
            className="min-h-16 text-sm"
            onChange={(e) => setText(e.target.value)}
          />
          {times}
          <div className="flex justify-end gap-2">
            {onCancel && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancel}
              >
                取消
              </Button>
            )}
            <Button type="submit" size="sm" disabled={busy || !text.trim()}>
              {submit}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <Input
              aria-label="新的记忆"
              value={text}
              maxLength={MAX_ITEM_TEXT}
              placeholder="添加一条，例如：每周三下午有吉他课"
              onChange={(e) => setText(e.target.value)}
            />
            <Tooltip label="设置时间">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="设置时间"
                aria-expanded={timed}
                onClick={() => setTimed((open) => !open)}
              >
                <ClockIcon />
              </Button>
            </Tooltip>
            <Button type="submit" disabled={busy || !text.trim()}>
              {submit}
            </Button>
          </div>
          {timed && times}
        </>
      )}
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
                {item.by === "conversation" && <span>来自对话</span>}
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
