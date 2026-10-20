import { useCallback, useState, useSyncExternalStore } from "react";
import { IdCardIcon, UploadIcon } from "lucide-react";
import { cn } from "cn";
import type { Agent, AgentProvider } from "../../modules/agents/contract";
import { parseRoleCard } from "../../modules/agents/store";
import { readRoleCardFile } from "../../modules/agents/role-card";
import { useAsyncAction } from "../components/useAsyncAction";
import { DialogBody } from "../components/Dialog";
import { ActionToast } from "../components/Toast";
import { Badge } from "../components/ui/badge";
import { Button, buttonVariants } from "../components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { Avatar } from "./Avatar";

export function RoleCardSettings({ api }: { api: AgentProvider }) {
  const subscribe = useCallback(
    (listener: () => void) => api.subscribe(listener),
    [api],
  );
  const snapshot = useCallback(() => api.list(), [api]);
  const agents = useSyncExternalStore(subscribe, snapshot);
  const [selected, setSelected] = useState(agents[0]?.id);
  const [name, setName] = useState(agents[0]?.name ?? "");
  const [description, setDescription] = useState(agents[0]?.description ?? "");
  const {
    busy,
    error,
    notice,
    setError,
    setNotice,
    run: act,
  } = useAsyncAction();
  const agent = agents.find((a) => a.id === selected);
  function select(a: Agent) {
    setSelected(a.id);
    setName(a.name);
    setDescription(a.description);
    setError("");
    setNotice("");
  }
  return (
    <DialogBody className="gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground">
          管理角色名称与说明，运行能力由对应扩展提供。
        </p>
        <label
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "cursor-pointer has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50",
            busy && "pointer-events-none opacity-50",
          )}
        >
          <UploadIcon data-icon="inline-start" />
          导入角色卡
          <input
            type="file"
            className="sr-only"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file)
                void act(async () => {
                  const card = await readRoleCardFile(file);
                  select(await api.create(parseRoleCard(card)));
                  setNotice("角色卡已导入。");
                });
            }}
          />
        </label>
      </div>
      {agents.length === 0 ? (
        <Empty className="gap-3 border border-dashed p-6 md:p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IdCardIcon />
            </EmptyMedia>
            <EmptyTitle className="text-sm">还没有角色卡</EmptyTitle>
            <EmptyDescription>
              选择 JSON 角色卡文件，添加你的第一个 Agent。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <ToggleGroup
            type="single"
            aria-label="选择角色卡"
            spacing={1}
            className="flex-wrap"
            value={selected ?? ""}
            disabled={busy}
            onValueChange={(id) => {
              const next = agents.find((a) => a.id === id);
              if (next) select(next);
            }}
          >
            {agents.map((a) => (
              <ToggleGroupItem
                key={a.id}
                value={a.id}
                variant="outline"
                className="h-auto gap-2 py-1 pr-3 pl-1 data-[state=on]:border-brand/40 data-[state=on]:bg-brand-soft/60"
              >
                <Avatar agent={a} size="small" />
                {a.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {agent && (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  await api.update(agent.id, { name, description });
                  setNotice("角色卡已保存。");
                });
              }}
            >
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor="role-card-name">角色名称</FieldLabel>
                  <Input
                    id="role-card-name"
                    value={name}
                    maxLength={60}
                    required
                    disabled={busy}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="role-card-description">
                    角色说明
                  </FieldLabel>
                  <Textarea
                    id="role-card-description"
                    value={description}
                    maxLength={4000}
                    rows={4}
                    disabled={busy}
                    className="min-h-24"
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Field>
              </FieldGroup>
              <div className="grid gap-2 rounded-xl bg-muted/50 px-3.5 py-3 text-xs text-muted-foreground">
                <p>
                  {api.info.label} · {api.info.version} ·{" "}
                  {agent.multiSession ? "支持多个会话" : "单个会话"}
                </p>
                <p className="flex flex-wrap items-center gap-1.5">
                  可用能力：
                  {agent.capabilities.map((capability) => (
                    <Badge key={capability} variant="outline">
                      {capability}
                    </Badge>
                  ))}
                </p>
              </div>
              <Button
                type="submit"
                className="justify-self-end max-md:justify-self-stretch"
                disabled={busy || !name.trim()}
              >
                {busy ? "正在保存…" : "保存角色卡"}
              </Button>
            </form>
          )}
        </>
      )}
      <ActionToast
        error={error}
        notice={notice}
        onDone={() => {
          setError("");
          setNotice("");
        }}
      />
    </DialogBody>
  );
}
