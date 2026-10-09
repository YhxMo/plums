import { bootstrap } from "./sdk-bootstrap.js";
import ivm from "isolated-vm";
import path from "node:path";

process.on("disconnect", () => process.exit());
const send = (value: unknown) => process.send?.(value);
let isolate: ivm.Isolate;
let context: ivm.Context;
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let active = "";
let executionStartedAt = 0n;
function beginExecution(id: string): void {
  active = id;
  executionStartedAt = isolate.wallTime;
}
// JSON transport objects must not become JavaScript object literals: __proto__
// has different semantics in a literal than in JSON data.
function jsonValue(value: unknown): string {
  const encoded = JSON.stringify(value);
  return encoded === undefined
    ? "undefined"
    : `JSON.parse(${JSON.stringify(encoded)})`;
}
async function evaluate(source: string): Promise<unknown> {
  const result = await context.eval(source, { timeout: 5000, copy: true });
  // Count each isolate execution interval once, even when eval requests overlap.
  // Host RPC waiting and eval queue waiting do not advance the isolate clock.
  if (active && isolate.wallTime - executionStartedAt > 5_000_000_000n)
    throw Error("CPU budget exceeded");
  return result;
}
async function pump(): Promise<void> {
  if (disposed) return;
  try {
    const wire = (await evaluate("JSON.stringify(__drain())")) as string;
    if (Buffer.byteLength(wire) > 1024 * 1024) throw Error("Message limit");
    for (const item of JSON.parse(wire)) {
      if (item.type === "result" && item.id === active) {
        active = "";
        executionStartedAt = 0n;
      }
      send(item);
    }
    send({ type: "heartbeat", rss: process.memoryUsage().rss });
    timer = setTimeout(() => {
      void pump();
    }, 10);
  } catch {
    disposed = true;
    send({ type: "fatal" });
    process.exit(1);
  }
}
process.on("message", async (raw: unknown) => {
  const m = raw as {
    type: string;
    files: Record<string, string>;
    entry: string;
    id: string;
    kind: string;
    name: string;
    input: unknown;
    ok: boolean;
    value: unknown;
    topic: string;
    event: unknown;
  };
  try {
    if (m.type === "start") {
      isolate = new ivm.Isolate({
        memoryLimit: 64,
        onCatastrophicError: () => process.abort(),
      });
      context = await isolate.createContext();
      await evaluate(bootstrap);
      const modules = new Map<string, ivm.Module>();
      const load = async (at: string): Promise<ivm.Module> => {
        if (!Object.hasOwn(m.files, at)) throw Error("Module missing");
        let module = modules.get(at);
        if (!module) {
          module = await isolate.compileModule(m.files[at]!);
          modules.set(at, module);
        }
        return module;
      };
      const entry = await load(m.entry);
      await entry.instantiate(context, async (specifier, referrer) => {
        if (!specifier.startsWith("./") && !specifier.startsWith("../"))
          throw Error("External imports denied");
        const owner = [...modules].find(([, mod]) => mod === referrer)?.[0];
        if (!owner) throw Error("Unknown module");
        const at = path.posix.normalize(
          path.posix.join(path.posix.dirname(owner), specifier),
        );
        if (at.startsWith("../") || at.startsWith("/"))
          throw Error("Module escape");
        return load(at);
      });
      beginExecution("start");
      await entry.evaluate({ timeout: 5000 });
      const activate = await entry.namespace.get("activate", {
        reference: true,
      });
      await context.global.set("__activate", activate.derefInto());
      const deactivate = await entry.namespace.get("deactivate", {
        reference: true,
      });
      if ((await deactivate.typeof) === "function")
        await context.global.set("__deactivate", deactivate.derefInto());
      await evaluate(
        "Promise.resolve().then(()=>__activate(plums)).then(()=>__done('start',true,null),()=>__done('start',false,null));void 0",
      );
      void pump();
    } else if (m.type === "stop") {
      if (timer) clearTimeout(timer);
      await context.eval(
        "if(typeof __deactivate==='function')__deactivate();void 0",
        { timeout: 500 },
      );
      disposed = true;
      isolate.dispose();
      process.exit();
    } else if (m.type === "event") {
      beginExecution(m.id);
      await evaluate(
        `__event(${JSON.stringify(m.id)},${JSON.stringify(m.topic)},${jsonValue(m.event)});void 0`,
      );
    } else if (m.type === "invoke") {
      beginExecution(m.id);
      await evaluate(
        `__invoke(${JSON.stringify(m.id)},${JSON.stringify(m.kind)},${JSON.stringify(m.name)},${jsonValue(m.input)});void 0`,
      );
    } else if (m.type === "reply") {
      await evaluate(
        `__settle(${JSON.stringify(m.id)},${m.ok === true},${jsonValue(m.value ?? null)});void 0`,
      );
    }
  } catch {
    disposed = true;
    send({ type: "fatal" });
    process.exit(1);
  }
});
process.on("disconnect", () => {
  disposed = true;
  if (timer) clearTimeout(timer);
  isolate?.dispose();
  process.exit();
});
