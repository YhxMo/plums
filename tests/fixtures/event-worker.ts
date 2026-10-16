import type { ExtensionDefinition } from "../../modules/sdk";

export interface EventWorkerSnapshot {
  received: number;
  done: number;
  cancelled: number;
  failed: number;
  busy: boolean;
}

export interface EventWorker {
  inspect(): EventWorkerSnapshot;
  readAgain(): Promise<unknown>;
}

export function createEventWorker(): ExtensionDefinition {
  return {
    manifest: {
      id: "event.worker",
      version: "1.0.0",
      apiVersion: 1,
      capabilities: ["state.read"],
      provides: { "event.worker": 1 },
    },
    activate(ctx) {
      const state: EventWorkerSnapshot = {
        received: 0,
        done: 0,
        cancelled: 0,
        failed: 0,
        busy: false,
      };
      const worker: EventWorker = {
        inspect: () => ({ ...state }),
        async readAgain() {
          return ctx.platform("state.read");
        },
      };
      ctx.provide("event.worker", 1, worker);

      async function execute(id: string, hold: boolean) {
        try {
          await ctx.task(async (signal) => {
            await ctx.platform("state.read", undefined, signal);
            if (signal.aborted) throw signal.reason;
            if (hold) {
              ctx.emit("event.receipt", { id, status: "started" });
              await new Promise<void>((resolve) => {
                if (signal.aborted) resolve();
                else
                  signal.addEventListener("abort", () => resolve(), {
                    once: true,
                  });
              });
              if (signal.aborted) throw signal.reason;
            }
            state.done += 1;
            ctx.emit("event.receipt", { id, status: "done" });
          });
        } catch {
          if (ctx.signal.aborted) state.cancelled += 1;
          else state.failed += 1;
        } finally {
          state.busy = false;
        }
      }

      ctx.on("event.submit", (data) => {
        if (
          !data ||
          typeof data !== "object" ||
          !("id" in data) ||
          typeof data.id !== "string" ||
          ("hold" in data &&
            data.hold !== undefined &&
            typeof data.hold !== "boolean")
        )
          return;
        state.received += 1;
        if (state.busy) {
          try {
            ctx.emit("event.receipt", { id: data.id, status: "busy" });
          } catch {
            state.failed += 1;
          }
          return;
        }
        state.busy = true;
        // execute handles synchronous scheduling errors and asynchronous rejections.
        void execute(data.id, "hold" in data && data.hold === true);
      });
    },
  };
}
