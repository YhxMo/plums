import { hostError, within } from "./lifecycle";

export const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Everything one activation owns; disposing it releases in reverse order. */
export class Scope {
  constructor(
    private readonly describe: (error: unknown) => string = message,
  ) {}
  readonly controller = new AbortController();
  readonly tasks = new Set<Promise<unknown>>();
  readonly disposers: (() => void | Promise<void>)[] = [];
  readonly errors = new Set<string>();
  readonly failedMounts = new Set<() => void | Promise<void>>();
  private accepting = true;
  private disposed = false;
  get open() {
    return this.accepting && !this.controller.signal.aborted;
  }
  invalidate() {
    this.accepting = false;
  }
  assertOpen() {
    if (!this.open) throw hostError("Extension stopped");
  }
  /** Register cleanup; rejects once the scope stopped accepting work. */
  own(dispose: () => void | Promise<void>) {
    this.assertOpen();
    this.disposers.push(dispose);
  }
  async dispose(timeout: number) {
    if (this.disposed) {
      if (this.errors.size) throw new Error([...this.errors].join("; "));
      return;
    }
    this.invalidate();
    this.controller.abort();
    for (const dispose of this.disposers.splice(0).reverse()) {
      try {
        await within(Promise.resolve().then(dispose), timeout);
      } catch (error) {
        this.errors.add(this.describe(error));
      }
    }
    try {
      await within(Promise.allSettled([...this.tasks]), timeout);
    } catch (error) {
      this.errors.add(this.describe(error));
    }
    this.disposed = true;
    if (this.errors.size) throw new Error([...this.errors].join("; "));
  }
}
