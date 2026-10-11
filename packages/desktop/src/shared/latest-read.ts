/** Serialize polling or batch refresh triggers; never reuse an outdated result. */
export class LatestRead<Input, Output> {
  private generation = 0;
  private running = false;
  private pending?: {
    input: Input;
    generation: number;
    resolve: (value: Output | undefined) => void;
    reject: (error: unknown) => void;
  };
  constructor(
    private readonly read: (
      input: Input,
      current: () => boolean,
    ) => Promise<Output | undefined>,
    private readonly mode: "serial" | "batch" = "serial",
  ) {}
  request(input: Input): Promise<Output | undefined> {
    const generation = ++this.generation;
    this.pending?.resolve(undefined);
    return new Promise((resolve, reject) => {
      this.pending = { input, generation, resolve, reject };
      if (this.mode === "batch") queueMicrotask(() => void this.drain());
      else void this.drain();
    });
  }
  invalidate() {
    this.generation++;
    this.pending?.resolve(undefined);
    this.pending = undefined;
  }
  private async drain() {
    if (!this.pending || (this.running && this.mode === "serial")) return;
    this.running = true;
    const item = this.pending;
    this.pending = undefined;
    const current = () => item.generation === this.generation;
    try {
      const value = await this.read(item.input, current);
      item.resolve(current() ? value : undefined);
    } catch (error) {
      if (current()) item.reject(error);
      else item.resolve(undefined);
    } finally {
      this.running = false;
      if (this.pending) queueMicrotask(() => void this.drain());
    }
  }
}
