import type { ReactNode } from "react";
import { ArrowRightIcon, IdCardIcon, PuzzleIcon } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "cn";
import { panel } from "./panel";
import { Button } from "@/components/ui/button";

const rise = (delay: number) =>
  ({
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.35, ease: "easeOut", delay },
  }) as const;

function Start({
  icon,
  title,
  description,
  action,
  delay,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action: string;
  delay: number;
  onClick: (source: HTMLElement) => void;
}) {
  return (
    <motion.button
      data-slot="start-card"
      {...rise(delay)}
      whileHover={{ y: -2 }}
      className="group/start flex min-w-0 flex-col items-start rounded-xl bg-card p-4.5 text-left shadow-raised outline-none transition-shadow hover:shadow-float focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={(e) => onClick(e.currentTarget)}
    >
      <span className="mb-3.5 grid size-10 place-items-center rounded-xl bg-brand-soft text-brand-text [&_svg]:size-5">
        {icon}
      </span>
      <strong className="mb-1.5 text-sm font-semibold">{title}</strong>
      <span className="text-xs leading-relaxed text-muted-foreground">
        {description}
      </span>
      <span className="mt-4 flex items-center gap-1 text-xs font-medium text-brand-text">
        {action}
        <ArrowRightIcon className="size-3.5 transition-transform group-hover/start:translate-x-0.5" />
      </span>
    </motion.button>
  );
}

export function EmptyState({
  hasAgents,
  onImport,
  onExtensions,
  onAdd,
}: {
  hasAgents: boolean;
  onImport: (source: HTMLElement) => void;
  onExtensions: () => void;
  onAdd: (source: HTMLElement) => void;
}) {
  if (hasAgents)
    return (
      <main
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-3 p-7 md:bg-background",
          panel,
        )}
      >
        <motion.img
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 0.28, scale: 1 }}
          className="size-22 object-contain grayscale"
          src="/brand/plums.png"
          alt="Plums"
        />
        <p className="text-xs text-muted-foreground">
          从左侧选择一个 Agent 开始对话
        </p>
      </main>
    );
  return (
    <main
      className={cn(
        "flex flex-1 flex-col items-center justify-center overflow-auto p-7 max-md:px-5 md:bg-background",
        panel,
      )}
    >
      <motion.div {...rise(0)} className="text-center">
        <img
          src="/brand/plums.png"
          alt=""
          className="mx-auto mb-4 block size-12 rounded-[11px] drop-shadow-md"
        />
        <h1 className="my-2 text-[22px] leading-snug font-semibold tracking-tight max-md:text-2xl">
          欢迎使用 Plums
        </h1>
        <p className="text-[13px] text-muted-foreground">
          添加你的第一个 Agent，
          <br className="md:hidden" />
          把角色、模型与扩展拼在一起。
        </p>
      </motion.div>
      <div className="mt-6 grid w-full max-w-[560px] grid-cols-2 gap-3 max-sm:grid-cols-1">
        <Start
          icon={<IdCardIcon />}
          title="导入角色卡"
          description="从文件或链接，了解并添加 Agent"
          action="选择角色卡"
          delay={0.06}
          onClick={onImport}
        />
        <Start
          icon={<PuzzleIcon />}
          title="安装扩展"
          description="导入本地扩展，添加新的能力"
          action="查看扩展"
          delay={0.12}
          onClick={() => onExtensions()}
        />
      </div>
      <motion.p
        {...rise(0.18)}
        className="mt-5 text-[13px] text-muted-foreground"
      >
        也可以
        <Button
          variant="link"
          className="h-auto px-1 text-[13px] text-brand-text max-md:min-h-11"
          onClick={(e) => onAdd(e.currentTarget)}
        >
          从头添加 Agent
        </Button>
      </motion.p>
    </main>
  );
}
