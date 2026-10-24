import { useRef, useState, type RefObject } from "react";
import type { Agent } from "@modules/agents/contract";
import { useAsyncAction } from "@/components/useAsyncAction";
import { useRoleCardDraft, type RoleCardDraft } from "./useRoleCardDraft";

export type AgentModal =
  | "add"
  | "create"
  | "import"
  | {
      action: "rename" | "remove" | "deleteSession" | "renameSession";
      agent: Agent;
      session?: string;
    }
  | {
      /** Asks before an edit or regeneration drops `count` later messages. */
      action: "truncate";
      agent: Agent;
      count: number;
      run: () => void;
    }
  | null;
export type AgentModals = {
  modal: AgentModal;
  /** The step `back()` returns to, if this one was reached from another. */
  previous: AgentModal;
  name: string;
  busy: boolean;
  error: string;
  notice: string;
  roleCard: RoleCardDraft;
  modalTrigger: RefObject<HTMLElement | null>;
  setName(value: string): void;
  setModal(value: AgentModal): void;
  setError(value: string): void;
  setNotice(value: string): void;
  /** Opens a dialog, or a further step of the open one. */
  open(next: AgentModal, source?: HTMLElement | null): void;
  back(): void;
  closeModal(): void;
  act(run: () => Promise<void>): Promise<void>;
  /** Like `act`, for work no dialog waits for, such as a reply. */
  report(run: () => Promise<void>): Promise<void>;
};

export function useAgentModals(): AgentModals {
  const { run: act, ...feedback } = useAsyncAction({
    abortNotice: "已取消，对方不会回复这条消息。",
  });
  const [steps, setSteps] = useState<NonNullable<AgentModal>[]>([]);
  const [name, setName] = useState("");
  const modalTrigger = useRef<HTMLElement | null>(null);
  const roleCard = useRoleCardDraft(feedback.setError);
  const modal = steps.at(-1) ?? null;
  function setModal(value: AgentModal) {
    setSteps(value ? [value] : []);
  }
  function closeModal() {
    if (feedback.busy) return;
    roleCard.cancelRead();
    setSteps([]);
  }
  function open(next: AgentModal, source?: HTMLElement | null) {
    if (!modal) modalTrigger.current = source ?? null;
    setSteps((current) => (next ? [...current, next] : []));
    feedback.setError("");
    setName(
      typeof next !== "object" || !next
        ? ""
        : next.action === "renameSession"
          ? (next.agent.sessions.find((s) => s.id === next.session)?.title ??
            "")
          : next.agent.name,
    );
  }
  function back() {
    if (feedback.busy) return;
    roleCard.cancelRead();
    feedback.setError("");
    setSteps((current) => current.slice(0, -1));
  }
  return {
    ...feedback,
    modal,
    previous: steps.at(-2) ?? null,
    name,
    roleCard,
    modalTrigger,
    setName,
    setModal,
    open,
    back,
    closeModal,
    act,
  };
}
