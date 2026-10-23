import { useState } from "react";
import { motion } from "motion/react";
import { SearchIcon } from "lucide-react";
import type { ListedModel } from "@modules/models/extension";
import { MAX_MODELS } from "@modules/models/providers";
import { tokenLabel } from "@modules/models/protocols";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

/**
 * The service's model list with each one's window from models.dev: filter,
 * tick, and add the ticked ones with their windows.
 */
export function ModelPicker({
  available,
  added,
  onAdd,
  onClose,
}: {
  available: readonly ListedModel[];
  added: readonly string[];
  onAdd: (models: ListedModel[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const room = MAX_MODELS - added.length;
  // Manual additions can change both membership and room while this is open.
  const selected = available.filter(
    ({ name }) => picked.includes(name) && !added.includes(name),
  );
  const overCapacity = selected.length > room;
  const shown = available.filter(({ name }) =>
    name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const toggle = (model: string) =>
    setPicked((value) =>
      value.includes(model)
        ? value.filter((item) => item !== model)
        : [...value, model],
    );
  return (
    <motion.div
      role="group"
      aria-label="服务提供的模型"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="grid gap-2 rounded-xl bg-muted/50 p-3 shadow-panel"
    >
      <span className="text-xs text-muted-foreground">
        找到 {available.length} 个模型
        {room < available.length && `，还能添加 ${Math.max(room, 0)} 个`}
      </span>
      {available.length > 8 && (
        <InputGroup className="bg-card max-md:h-11">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="筛选模型"
            placeholder="筛选模型"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
      )}
      <ul className="max-h-60 overflow-y-auto rounded-lg bg-card p-1 shadow-panel">
        {shown.map(({ name: model, context }) => {
          const exists = added.includes(model);
          const checked = exists || picked.includes(model);
          return (
            <li key={model} className="min-w-0">
              <label className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-muted/60 has-disabled:cursor-not-allowed has-disabled:opacity-60 max-md:min-h-11">
                <Checkbox
                  checked={checked}
                  disabled={exists || (!checked && selected.length >= room)}
                  onCheckedChange={() => toggle(model)}
                />
                <span className="min-w-0 break-all">{model}</span>
                {context && (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    上下文 {tokenLabel(context)}
                  </span>
                )}
                {exists && (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    已添加
                  </span>
                )}
              </label>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="px-2 py-3 text-center text-xs text-muted-foreground">
            没有匹配的模型。
          </li>
        )}
      </ul>
      {overCapacity && (
        <p role="alert" className="text-xs text-destructive">
          最多还能添加 {Math.max(room, 0)}{" "}
          个，请取消部分选择或移除已添加的模型。
        </p>
      )}
      <div className="flex justify-end gap-2 max-form:*:flex-1">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          收起
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={selected.length === 0 || overCapacity}
          onClick={() => onAdd(selected)}
        >
          添加所选（{selected.length}）
        </Button>
      </div>
    </motion.div>
  );
}
