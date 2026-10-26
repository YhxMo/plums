import type { Agent } from "./contract";

/** The message a reply is being asked for, shown while it is awaited. */
export type Pending = NonNullable<Agent["pending"]>;

/**
 * Replies being asked for, one per Agent: what was sent, how to stop it,
 * and whether its save has been dispatched and can no longer be stopped.
 * Nothing here is saved; a restart forgets every reply in flight.
 */
export class ReplyTasks {
  private tasks = new Map<
    string,
    { controller: AbortController; pending: Pending; committing: boolean }
  >();

  /** Starts asking for `agentId`, which has none in flight; its signal stops the model and the save. */
  start(agentId: string, pending: Pending) {
    const controller = new AbortController();
    this.tasks.set(agentId, { controller, pending, committing: false });
    return controller.signal;
  }
  /** The save is dispatched: from here on the reply can no longer be stopped. */
  committing(agentId: string) {
    const task = this.tasks.get(agentId);
    if (task) task.committing = true;
  }
  finish(agentId: string) {
    this.tasks.delete(agentId);
  }
  cancel(agentId: string) {
    const task = this.tasks.get(agentId);
    if (task && !task.committing) task.controller.abort();
  }
  cancelAll() {
    this.tasks.forEach((task) => task.controller.abort());
  }
  has(agentId: string) {
    return this.tasks.has(agentId);
  }
  pending(agentId: string) {
    return this.tasks.get(agentId)?.pending;
  }
  /** Whether `agentId` waits for a reply in `sessionId`. */
  waitsIn(agentId: string, sessionId: string | undefined) {
    return this.pending(agentId)?.sessionId === sessionId;
  }
  canCancel(agentId: string) {
    const task = this.tasks.get(agentId);
    return !!task && !task.committing;
  }
}
