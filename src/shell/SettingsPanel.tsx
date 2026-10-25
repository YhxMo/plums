import type { ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { ShellDialogsProps } from "./controllers";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { VERSION } from "./version";

type Props = Pick<ShellDialogsProps["operations"], "busy" | "operate"> &
  Pick<ShellDialogsProps["workspace"], "views" | "activeView"> & {
    selectLayout(id: string): Promise<void>;
    appearance: ShellDialogsProps["appearance"];
    openManager(diagnostics?: boolean): void;
    openAbout(): void;
  };

const BUILTIN = "builtin";

/** One group of rows in one hairline box. */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="divide-y rounded-lg border">
      {children}
    </ul>
  );
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex min-h-12 items-center justify-between gap-4 py-1.5 pr-2 pl-3">
      <span className="min-w-0 shrink">{label}</span>
      {children}
    </li>
  );
}
/** A row that opens a page of its own. */
function LinkRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        data-slot="settings-link"
        className="flex min-h-12 w-full items-center justify-between gap-4 rounded-lg px-3 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={onClick}
      >
        {label}
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {value}
          <ChevronRightIcon aria-hidden="true" className="size-4" />
        </span>
      </button>
    </li>
  );
}
/**
 * A choice that reads as the row's value and opens a menu of the others.
 * Choosing the current one again still reports it, which confirms it.
 */
function Choice({
  label,
  value,
  options,
  disabled,
  onChoose,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; detail?: string }[];
  disabled?: boolean;
  onChoose: (value: string) => void;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          // The row's name, then the value shown.
          aria-label={`${label}，${current?.label ?? "未选择"}`}
          disabled={disabled}
          className="text-sm font-normal text-muted-foreground"
        >
          {current?.label ?? "未选择"}
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuRadioGroup value={value}>
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              onSelect={() => onChoose(option.value)}
            >
              <span className="grid">
                {option.label}
                {option.detail && (
                  <span className="text-xs text-muted-foreground">
                    {option.detail}
                  </span>
                )}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Application settings in two groups: how the app looks (colour, theme and
 * interface), then diagnostics and about.
 */
export function SettingsPanel({
  busy,
  operate,
  views,
  activeView,
  selectLayout,
  appearance: { appearance, themes, themeId, selectTheme, toggleTheme },
  openManager,
  openAbout,
}: Props) {
  return (
    <>
      <Group label="外观">
        <Row label="颜色">
          <ToggleGroup
            type="single"
            aria-label="颜色"
            spacing={0.5}
            className="rounded-md bg-muted p-0.5"
            disabled={busy}
            value={appearance}
            onValueChange={(next) => {
              if (next && next !== appearance) void operate(toggleTheme);
            }}
          >
            {(
              [
                ["light", "浅色"],
                ["dark", "深色"],
              ] as const
            ).map(([value, label]) => (
              <ToggleGroupItem
                key={value}
                value={value}
                className="h-7 rounded-sm px-3 font-normal text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-foreground"
              >
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Row>
        <Row label="主题">
          <Choice
            label="主题"
            disabled={busy}
            value={themeId ?? BUILTIN}
            onChoose={(id) =>
              void operate(() => selectTheme(id === BUILTIN ? null : id))
            }
            options={[
              { value: BUILTIN, label: "内置" },
              ...themes.map((entry) => ({
                value: entry.id,
                label: entry.label,
                detail: `${entry.id}，来自 ${entry.owner}`,
              })),
            ]}
          />
        </Row>
        <Row label="界面">
          <Choice
            label="界面"
            value={activeView ?? ""}
            onChoose={(id) => void operate(() => selectLayout(id))}
            options={views.map((view) => ({
              value: view.id,
              label: view.label,
            }))}
          />
        </Row>
      </Group>
      <Group label="其他">
        {import.meta.env.DEV && (
          <LinkRow label="诊断工具" onClick={() => openManager(true)} />
        )}
        <LinkRow label="关于 Plums" value={VERSION} onClick={openAbout} />
      </Group>
    </>
  );
}
