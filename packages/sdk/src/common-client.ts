import type {
  CommonPlatformSdk,
  CommonCall,
  CommonEnvelope,
  CommonResourcesSdk,
  CommonTaskSnapshot,
} from "./common-contract.js";
/** The same pull transport is used by the trusted preload and isolated/background workers. */
export function createCommonPlatformSdk(
  rpc: (method: string, args: Record<string, unknown>) => Promise<any>,
  resources: CommonResourcesSdk,
): CommonPlatformSdk {
  const wait = () => rpc("wait", {});
  const byteLength = (s: string) => {
    let size = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0)!;
      size += c < 128 ? 1 : c < 2048 ? 2 : c < 65536 ? 3 : 4;
    }
    return size;
  };
  const call = (
    info: { callId: string; taskId: string },
    after = -1,
  ): CommonCall => {
    let sequence = after,
      ended = false,
      bytes = 0;
    const events: Extract<CommonEnvelope, { kind: "event" }>[] = [];
    let wake = () => {};
    const result = (async () => {
      try {
        while (!ended) {
          const batch = await rpc("poll", {
            taskId: info.taskId,
            afterSequence: sequence,
          });
          for (const m of batch.messages as CommonEnvelope[]) {
            if (
              m.callId !== info.callId ||
              !("sequence" in m) ||
              m.sequence !== sequence + 1
            )
              throw Error("Invalid common reply order");
            sequence = m.sequence;
            if (m.kind === "event") {
              events.push(m);
              bytes += byteLength(JSON.stringify(m));
              if (events.length > 256 || bytes > 8 * 1024 * 1024) {
                await rpc("cancel", { taskId: info.taskId });
                throw Error("Common event consumer limit");
              }
              wake();
            }
            if (m.kind === "result") {
              ended = true;
              wake();
              return m;
            }
          }
          if (!batch.messages.length && batch.snapshot.result) {
            ended = true;
            wake();
            return batch.snapshot.result;
          }
          if (
            !batch.messages.length &&
            ["stopped", "crashed", "completed"].includes(
              batch.snapshot.status.state,
            )
          )
            throw Error("Common replay unavailable");
          await rpc("ack", { taskId: info.taskId, sequence });
          await wait();
        }
      } finally {
        ended = true;
        wake();
      }
      throw Error("Common result unavailable");
    })();
    void result.catch(() => {});
    const iterator = (async function* () {
      while (!ended || events.length) {
        if (events.length) {
          const m = events.shift()!;
          bytes -= byteLength(JSON.stringify(m));
          yield m;
        } else
          await new Promise<void>((r) => {
            wake = r;
          });
      }
    })();
    const eventStream: AsyncIterableIterator<
      Extract<CommonEnvelope, { kind: "event" }>
    > = {
      next: () => iterator.next(),
      return: () => iterator.return(),
      [Symbol.asyncIterator]: () => eventStream,
    };
    return {
      ...info,
      result,
      cancel: () => rpc("cancel", { taskId: info.taskId }),
      events: eventStream,
    };
  };
  return Object.freeze({
    discover: (requirementId: string) => rpc("discover", { requirementId }),
    binding: (requirementId: string) => rpc("binding", { requirementId }),
    invoke: async (
      binding: string,
      operation: string,
      input: any,
      options: any = {},
    ) => call(await rpc("invoke", { binding, operation, input, options })),
    attach: async (taskId: string, afterSequence = -1) => {
      const s: CommonTaskSnapshot = await rpc("status", { taskId });
      if (!s.status.callId) throw Error("Task has no invocation");
      return call({ taskId, callId: s.status.callId }, afterSequence);
    },
    tasks: Object.freeze({
      create: (options: any) => rpc("create", { options }),
      status: (taskId: string) => rpc("status", { taskId }),
      list: () => rpc("listTasks", {}),
      subscribe: (
        taskId: string,
        callback: (s: CommonTaskSnapshot) => void,
        onError?: (e: unknown) => void,
      ) => {
        let active = true,
          previous = "";
        void (async () => {
          try {
            while (active) {
              const snapshot: CommonTaskSnapshot = await rpc("status", {
                taskId,
              });
              if (!active) return;
              const signature = JSON.stringify(snapshot.status);
              if (signature !== previous) {
                previous = signature;
                callback(snapshot);
              }
              if (
                ["completed", "stopped", "crashed"].includes(
                  snapshot.status.state,
                )
              )
                return;
              await rpc("stateWait", {});
            }
          } catch (error) {
            if (active) onError?.(error);
          }
        })();
        return () => {
          active = false;
        };
      },
    }),
    policy: Object.freeze({ status: () => rpc("policyStatus", {}) }),
    resources,
  });
}
