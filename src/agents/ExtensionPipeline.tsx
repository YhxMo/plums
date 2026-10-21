import { GripVerticalIcon, PuzzleIcon } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "cn";
import type { ExtensionChoice } from "../../modules/agents/contract";
import { Switch } from "../components/ui/switch";
import { Tooltip } from "../components/Tooltip";
import type { Part } from "./parts";

/** `index` numbers a step of the reply; `note` says what being off means. */
type Row = {
  choice: ExtensionChoice;
  on: boolean;
  index?: number;
  note?: string;
};

type Drag = ReturnType<typeof useSortable>;

function SortableRow(props: Omit<Parameters<typeof PipelineRow>[0], "drag">) {
  const drag = useSortable({
    id: props.row.choice.id,
    disabled: !props.sortable || props.disabled,
  });
  return <PipelineRow {...props} drag={drag} />;
}

function PipelineRow({
  row,
  agentName,
  sortable,
  disabled,
  drag,
  onToggle,
  onOpen,
}: {
  row: Row;
  agentName: string;
  sortable: boolean;
  disabled?: boolean;
  drag?: Drag;
  onToggle: (on: boolean) => void;
  onOpen?: () => void;
}) {
  const { choice, on, index, note } = row;
  const warn = !on && note;
  const name = (
    <>
      <span className="truncate text-[13px] font-medium">{choice.label}</span>
      <span
        className={cn(
          "w-full truncate text-xs text-muted-foreground",
          warn && "text-destructive",
        )}
      >
        {warn ? note : choice.description}
      </span>
    </>
  );
  return (
    <li
      ref={drag?.setNodeRef}
      style={
        drag && {
          transform: CSS.Translate.toString(drag.transform),
          transition: drag.transition,
        }
      }
      className={cn(
        "relative flex items-center gap-2 rounded-lg bg-card py-2 pr-3 pl-1.5 shadow-panel transition-[box-shadow,opacity]",
        !on &&
          "bg-transparent opacity-80 shadow-none ring-1 ring-border ring-inset",
        drag?.isDragging && "z-10 shadow-float",
        !sortable && "pl-3",
      )}
    >
      {sortable && drag && (
        <Tooltip label="拖动或用方向键调整顺序">
          <button
            ref={drag.setActivatorNodeRef}
            type="button"
            className="grid h-8 w-6 shrink-0 cursor-grab touch-none place-items-center rounded-md text-muted-foreground outline-none hover:bg-subtle hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50 max-md:h-11 max-md:w-8"
            aria-label={`调整 ${choice.label} 的顺序，当前第 ${index! + 1} 步`}
            disabled={disabled}
            {...drag.attributes}
            {...drag.listeners}
          >
            <GripVerticalIcon className="size-4" />
          </button>
        </Tooltip>
      )}
      {on && index !== undefined && (
        <span
          aria-hidden="true"
          className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand-text tabular-nums"
        >
          {index + 1}
        </span>
      )}
      {onOpen ? (
        <Tooltip label={choice.description || choice.id}>
          <button
            type="button"
            className="flex min-w-0 flex-1 flex-col items-start rounded-md text-left outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label={`查看扩展 ${choice.label}`}
            onClick={onOpen}
          >
            {name}
          </button>
        </Tooltip>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col">{name}</span>
      )}
      <Switch
        checked={on}
        disabled={disabled}
        aria-label={`在 ${agentName} 中使用 ${choice.label}`}
        onCheckedChange={onToggle}
      />
    </li>
  );
}

/**
 * The extensions an Agent is assembled from: its parts such as provider,
 * interface and model connection, then the text extensions switched on, in
 * the order replies pass through them (drag or arrow keys to reorder), then
 * the ones still available.
 */
export function ExtensionPipeline({
  agentName,
  parts = [],
  onPart,
  choices,
  value,
  onChange,
  onOpen,
  disabled,
}: {
  agentName: string;
  parts?: readonly Part[];
  onPart?: (part: Part, on: boolean) => void;
  choices: readonly ExtensionChoice[];
  /** Switched-on extension IDs, in order. */
  value: readonly string[];
  onChange: (ids: string[]) => void;
  onOpen?: (id: string) => void;
  disabled?: boolean;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const label = (id: string | number) =>
    choices.find((c) => c.id === id)?.label ?? String(id);
  const position = (id: string | number | undefined) =>
    id === undefined ? 0 : value.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `已拿起 ${label(active.id)}，当前第 ${position(active.id)} 步。`,
    onDragOver: ({ active, over }) =>
      over ? `${label(active.id)} 将移到第 ${position(over.id)} 步。` : "",
    onDragEnd: ({ active, over }) =>
      over
        ? `${label(active.id)} 已放到第 ${position(over.id)} 步。`
        : `${label(active.id)} 已放下。`,
    onDragCancel: ({ active }) => `已取消，${label(active.id)} 回到原位。`,
  };
  const on = value
    .map((id) => choices.find((c) => c.id === id))
    .filter((c): c is ExtensionChoice => !!c);
  const off = choices.filter((c) => !value.includes(c.id));
  const toggle = (id: string, next: boolean) =>
    onChange(next ? [...value, id] : value.filter((x) => x !== id));
  function end({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    onChange(
      arrayMove(
        [...value],
        value.indexOf(String(active.id)),
        value.indexOf(String(over.id)),
      ),
    );
  }
  return (
    <div className="grid grid-cols-1 gap-2">
      {parts.length > 0 && onPart && (
        <ul
          className="grid grid-cols-1 gap-1.5"
          aria-label={`${agentName} 的组成扩展`}
        >
          {parts.map((part) => (
            <PipelineRow
              key={part.choice.id}
              row={part}
              agentName={agentName}
              sortable={false}
              disabled={disabled}
              onToggle={(next) => onPart(part, next)}
              onOpen={onOpen && (() => onOpen(part.choice.id))}
            />
          ))}
        </ul>
      )}
      {!choices.length && (
        <p className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
          <PuzzleIcon className="size-4 shrink-0" />
          没有可开启的文本扩展。
        </p>
      )}
      {on.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                "按空格键拿起，用上下方向键移动，再按空格键放下；Esc 取消。",
            },
          }}
          onDragEnd={end}
        >
          <SortableContext
            items={[...value]}
            strategy={verticalListSortingStrategy}
          >
            <ol
              className="grid grid-cols-1 gap-1.5"
              aria-label={`${agentName} 的回复处理顺序`}
            >
              {on.map((choice, index) => (
                <SortableRow
                  key={choice.id}
                  row={{ choice, on: true, index }}
                  agentName={agentName}
                  sortable={on.length > 1}
                  disabled={disabled}
                  onToggle={(next) => toggle(choice.id, next)}
                  onOpen={onOpen && (() => onOpen(choice.id))}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      {off.length > 0 && (
        <ul className="grid grid-cols-1 gap-1.5" aria-label="可开启的扩展">
          {off.map((choice) => (
            <PipelineRow
              key={choice.id}
              row={{ choice, on: false }}
              agentName={agentName}
              sortable={false}
              disabled={disabled}
              onToggle={(next) => toggle(choice.id, next)}
              onOpen={onOpen && (() => onOpen(choice.id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
