import { useRef, useState, type RefObject } from "react";
import type { Agent } from "../../../modules/sdk/agents";
import { useAsyncAction } from "../../shell/useAsyncAction";
import { useRoleCardDraft, type RoleCardDraft } from "./useRoleCardDraft";

export type AgentModal =
  | "add"
  | "create"
  | "import"
  | {
      action: "rename" | "remove" | "deleteSession";
      agent: Agent;
      session?: string;
    }
  | null;
export type AgentModals = {
  modal: AgentModal;
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
  open(next: AgentModal, source?: HTMLElement | null): void;
  closeModal(): void;
  act(run: () => Promise<void>): Promise<void>;
};

export function useAgentModals(): AgentModals {
  const { run: act, ...feedback } = useAsyncAction({
    abortNotice: "已停止，未保存本次结果。",
  });
  const [modal, setModal] = useState<AgentModal>(null);
  const [name, setName] = useState("");
  const modalTrigger = useRef<HTMLElement | null>(null);
  const roleCard = useRoleCardDraft(feedback.setError);
  function closeModal() {
    if (feedback.busy) return;
    roleCard.cancelRead();
    setModal(null);
  }
  function open(next: AgentModal, source?: HTMLElement | null) {
    if (!modal) modalTrigger.current = source ?? null;
    setModal(next);
    feedback.setError("");
    setName(typeof next === "object" && next ? next.agent.name : "");
  }
  return {
    ...feedback,
    modal,
    name,
    roleCard,
    modalTrigger,
    setName,
    setModal,
    open,
    closeModal,
    act,
  };
}
