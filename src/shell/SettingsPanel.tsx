import type { ReactNode } from "react";
import { ChevronRightIcon, MoonIcon, SunIcon } from "lucide-react";
import type { ShellDialogsProps } from "./controllers";
import { Tooltip } from "@/components/Tooltip";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Props = Pick<ShellDialogsProps["operations"], "busy" | "operate"> &
  Pick<ShellDialogsProps["workspace"], "views" | "activeView"> & {
    selectLayout(id: string): Promise<void>;
    appearance: ShellDialogsProps["appearance"];
    openManager(diagnostics?: boolean): void;
  };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h3 className="px-1 text-xs font-medium text-muted-foreground">
        {title}
      </h3>
      <div className="divide-y rounded-xl bg-muted/50 px-3.5">{children}</div>
    </section>
  );
}
function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
      <span className="min-w-0 shrink">{label}</span>
      {children}
    </div>
  );
}
const choices =
  "flex-wrap justify-end rounded-lg bg-background/70 p-0.5 shadow-panel";
const choice =
  "h-7 px-3 text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-raised";

/** Application settings: one labelled row per choice, actions on the right. */
export function SettingsPanel({
  busy,
  operate,
  views,
  activeView,
  selectLayout,
  appearance: { appearance, themes, themeId, selectTheme, toggleTheme },
  openManager,
}: Props) {
  return (
    <>
      <Section title="界面与外观">
        <Row label="界面布局">
          <ToggleGroup
            type="single"
            aria-label="界面布局"
            spacing={0.5}
            className={choices}
            value={activeView ?? ""}
            // Choosing the current layout again also confirms and closes.
            onValueChange={(id) => {
              const next = id || activeView;
              if (next) void operate(() => selectLayout(next));
            }}
          >
            {views.map((view) => (
              <ToggleGroupItem
                key={view.id}
                value={view.id}
                aria-label={`使用 ${view.label}`}
                className={choice}
              >
                {view.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Row>
        <Row label="颜色模式">
          <Button variant="outline" onClick={() => void operate(toggleTheme)}>
            {appearance === "light" ? <MoonIcon /> : <SunIcon />}
            {appearance === "light" ? "切换到深色模式" : "切换到浅色模式"}
          </Button>
        </Row>
        <Row label="外观主题">
          <ToggleGroup
            type="single"
            aria-label="扩展主题"
            spacing={0.5}
            className={choices}
            disabled={busy}
            value={themeId ?? "builtin"}
            onValueChange={(id) =>
              id &&
              void operate(() => selectTheme(id === "builtin" ? null : id))
            }
          >
            <ToggleGroupItem
              value="builtin"
              aria-label="使用内置外观"
              className={choice}
            >
              内置外观
            </ToggleGroupItem>
            {themes.map((entry) => (
              <Tooltip key={entry.id} label={`${entry.id} · ${entry.owner}`}>
                <ToggleGroupItem
                  value={entry.id}
                  aria-label={`使用 ${entry.label} ${entry.id} · ${entry.owner}`}
                  className={choice}
                >
                  {entry.label}
                </ToggleGroupItem>
              </Tooltip>
            ))}
          </ToggleGroup>
        </Row>
      </Section>
      <p className="-mt-2 px-1 text-xs text-muted-foreground">
        界面和主题来自已启用的扩展；启用状态会自动保留到下次打开。
      </p>
      <Section title="扩展与连接">
        <Row
          label={
            <span className="text-muted-foreground">
              模型连接器和其他能力都在扩展中配置与启用。
            </span>
          }
        >
          <Button variant="outline" onClick={() => openManager()}>
            管理扩展
            <ChevronRightIcon data-icon="inline-end" />
          </Button>
        </Row>
      </Section>
      {import.meta.env.DEV && (
        <Section title="数据与诊断">
          <Row
            label={
              <span className="text-muted-foreground">
                数据保存在本机。诊断工具可检查任务、权限与恢复状态。
              </span>
            }
          >
            <Button variant="outline" onClick={() => openManager(true)}>
              打开诊断工具
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          </Row>
        </Section>
      )}
    </>
  );
}
