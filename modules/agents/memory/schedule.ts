/**
 * When each Agent's consolidation runs: one timer per Agent, which a new
 * request replaces, and one run at a time across Agents.
 */
export class ConsolidationSchedule {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private runs: Promise<unknown> = Promise.resolve();
  constructor(private consolidate: (agent: string) => Promise<void>) {}

  /** Runs `agent`'s consolidation after `delay` ms, replacing a waiting one. */
  later(agent: string, delay: number) {
    this.cancel(agent);
    this.timers.set(
      agent,
      setTimeout(() => {
        this.timers.delete(agent);
        void this.now(agent);
      }, delay),
    );
  }
  /** Whether `agent` waits for a timer. */
  waiting(agent: string) {
    return this.timers.has(agent);
  }
  cancel(agent: string) {
    clearTimeout(this.timers.get(agent));
    this.timers.delete(agent);
  }
  /** Runs it after the runs already queued, without waiting for a timer. */
  now(agent: string) {
    this.cancel(agent);
    const next = this.runs.then(() => this.consolidate(agent));
    this.runs = next.catch(() => {});
    return next;
  }
  /** Stops the timers; resolves once the run in progress has ended. */
  stop() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    return this.runs;
  }
}
