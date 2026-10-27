import type { Agent, ModelChoice } from "@modules/agents/contract";
import type { Named } from "@modules/sdk";
import { Button } from "@/components/ui/button";
import type { Blocked } from "./Composer";
import type { Part } from "./parts";

/**
 * The first thing stopping `a` from replying here, if any, with the button
 * that clears it: a reply awaited in another session, or a part switched off.
 */
export function replyBlocker(
  a: Agent,
  {
    parts,
    ui,
    models,
    onSelect,
    onTurnOn,
  }: {
    /** The Agent's parts, its provider first. */
    parts: readonly Part[];
    ui?: Named;
    /** Absent when the provider does not let Agents pick a model. */
    models?: readonly ModelChoice[];
    onSelect: (sessionId: string) => void;
    onTurnOn: (part: Part) => void;
  },
): Blocked | undefined {
  // One reply at a time per Agent; the session waiting for it is a click away.
  const waiting = a.pending?.sessionId;
  if (waiting && waiting !== a.currentSessionId)
    return {
      text: `正在等「${a.sessions.find((s) => s.id === waiting)?.title}」里的回复，回复后才能再发一条。`,
      action: (
        <Button type="button" onClick={() => onSelect(waiting)}>
          查看
        </Button>
      ),
    };
  const off = (part?: Part) => part && !part.on;
  const turnOn = (part: Part) => (
    <Button type="button" onClick={() => onTurnOn(part)}>
      开启
    </Button>
  );
  const [core] = parts;
  const view = ui && parts.find((p) => p.choice.id === ui.id);
  if (off(view))
    return {
      text: `此 Agent 已关闭「${view!.choice.label}」，开启后才能在这里对话。`,
      action: turnOn(view!),
    };
  if (off(core))
    return {
      text: `此 Agent 已关闭「${core.choice.label}」，开启后它才会回复。`,
      action: turnOn(core),
    };
  if (!models) return undefined;
  const picked =
    a.model &&
    models.some(
      (m) => m.provider === a.model!.provider && m.id === a.model!.model,
    );
  // Nothing picked yet: the message box shows the model picker itself.
  if (!picked) return undefined;
  const connection = parts.find((p) => p.choice.id === a.model!.provider);
  if (off(connection))
    return {
      text: `此 Agent 已关闭「${connection!.choice.label}」，开启后它才会回复。`,
      action: turnOn(connection!),
    };
  return undefined;
}
