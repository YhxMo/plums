import type { ExtensionDetailsProps } from "./controllers";
import type { ReactNode } from "react";
import { CheckIcon, PlusIcon } from "lucide-react";
import { cn } from "cn";
import { capabilityLabel } from "@modules/shell/capabilities";
import { CredentialBindings } from "./CredentialBindings";
import { sourceLabel } from "@modules/shell/extension-package";
import { serviceList } from "./services";
import { StatusBadge } from "./StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import { InfoTip } from "@/components/Tooltip";

/** One titled block of the details, separated from the one above. */
export function DetailSection({
  title,
  info,
  children,
}: {
  title: string;
  /** Background behind an info button beside the title. */
  info?: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-4 border-t pt-3.5 first:mt-0 first:border-0 first:pt-0">
      <h4 className="mb-2.5 flex items-center gap-1 text-[13px] font-semibold">
        {title}
        {info && <InfoTip label={title} text={info} />}
      </h4>
      {children}
    </section>
  );
}
export function ExtensionDetails({
  host,
  access,
  entry: activeSelectedExt,
  operations,
  inline,
}: ExtensionDetailsProps) {
  const extId = activeSelectedExt.id;
  const extState = host.inspect(extId);
  const extManifest = host.manifest(extId);
  const extCaps = extManifest.capabilities ?? [];
  const users = host.users(extId);
  // Views whose icon could not be drawn; the rail shows a generic one.
  const badIcons = host
    .views()
    .filter((view) => view.owner === extId && view.iconProblem);
  return (
    <section
      aria-label="所选扩展详情"
      className={cn(
        inline
          ? "mt-3 cursor-default border-t pt-3"
          : "rounded-xl bg-card p-5 shadow-raised",
      )}
      onClick={inline ? (event) => event.stopPropagation() : undefined}
    >
      <header hidden={inline} className="mb-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold tracking-tight">
            {activeSelectedExt.label}
          </h3>
          <StatusBadge status={extState.status} />
        </div>
        <code className="mt-1 block text-xs text-muted-foreground">
          {extId} · {extManifest.version}
        </code>
      </header>
      {extManifest.description && (
        // Author text from the manifest; React renders it as plain text.
        <p className="mt-3 [overflow-wrap:anywhere] whitespace-pre-line">
          {extManifest.description}
        </p>
      )}
      {users.map((group) => (
        <DetailSection
          key={group.owner}
          title={
            group.toggle ? `为 ${group.kind} 开启` : `使用中的 ${group.kind}`
          }
          info={
            group.toggle
              ? `点按为单个 ${group.kind} 开启或关闭此扩展。`
              : undefined
          }
        >
          <ul className="flex flex-wrap gap-1.5">
            {group.toggle
              ? [
                  ...group.users.map((user) => ({ ...user, on: true })),
                  ...group.others.map((user) => ({ ...user, on: false })),
                ].map((user) => (
                  <li key={user.id}>
                    <Toggle
                      size="sm"
                      variant="outline"
                      pressed={user.on}
                      aria-label={`在 ${user.label} 中使用 ${activeSelectedExt.label}`}
                      disabled={operations.busy}
                      className="border-dashed font-normal text-muted-foreground data-[state=on]:border-solid data-[state=on]:border-transparent data-[state=on]:bg-brand-soft data-[state=on]:text-foreground max-md:h-10"
                      onPressedChange={(on) =>
                        void operations.operate(() =>
                          host.toggleUser(group.owner, user.id, extId, on),
                        )
                      }
                    >
                      {user.on ? (
                        <CheckIcon className="text-brand-text" />
                      ) : (
                        <PlusIcon />
                      )}
                      {user.label}
                    </Toggle>
                  </li>
                ))
              : group.users.map((user) => (
                  <li key={user.id}>
                    <Badge className="bg-brand-soft text-foreground">
                      {user.label}
                    </Badge>
                  </li>
                ))}
          </ul>
        </DetailSection>
      ))}
      <DetailSection title="服务与权限概览">
        <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-xs [&_dd]:[overflow-wrap:anywhere] [&_dt]:text-muted-foreground">
          <dt>模块位置</dt>
          <dd>{sourceLabel(activeSelectedExt.url)}</dd>
          <dt>所需服务</dt>
          <dd>{serviceList(extManifest.requires, extManifest.optional)}</dd>
          <dt>提供服务</dt>
          <dd>{serviceList(extManifest.provides)}</dd>
          <dt>系统权限</dt>
          <dd>
            {extCaps.length
              ? extCaps
                  .map((cap) => capabilityLabel(cap, extManifest))
                  .join("、")
              : "无需原生能力"}
          </dd>
          <dt>运行资源</dt>
          <dd>
            {extState.resources} 项资源 · {extState.tasks} 个在途任务
          </dd>
          {badIcons.length > 0 && (
            <>
              <dt>界面图标</dt>
              <dd className="text-destructive">
                {badIcons
                  .map(
                    (view) =>
                      `「${view.label}」图标无效（${view.iconProblem}），已改用通用图标`,
                  )
                  .join("；")}
              </dd>
            </>
          )}
        </dl>
      </DetailSection>
      <CredentialBindings
        key={extId}
        access={access}
        operations={operations}
        id={extId}
        source={activeSelectedExt.url}
        version={extManifest.version}
        declarations={extManifest.credentialBindings ?? {}}
        managed={!!extManifest.credentialProtocols}
      />
    </section>
  );
}
