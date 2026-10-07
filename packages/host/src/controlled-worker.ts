import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { runInThisContext } from "node:vm";
import { bootstrap } from "./sdk-bootstrap.js";
const send = (m: unknown) => process.stdout.write(JSON.stringify(m) + "\n");
let busy = false;
runInThisContext(bootstrap);
const g = globalThis as unknown as {
  plums: unknown;
  __drain: () => unknown[];
  __settle: (id: string, ok: boolean, value: unknown) => void;
  __invoke: (id: string, kind: string, name: string, input: unknown) => void;
  __event: (id: string, topic: string, event: unknown) => void;
};
setInterval(() => {
  for (const m of g.__drain()) send(m);
  send({ type: "heartbeat", rss: process.memoryUsage().rss });
}, 10);
createInterface({ input: process.stdin }).on("line", (line) => {
  try {
    const m = JSON.parse(line);
    if (m.type === "start" && !busy) {
      busy = true;
      void import(pathToFileURL(process.argv[2]!).href)
        .then(async (module) => {
          await module.activate(g.plums);
          send({ type: "result", id: m.id, ok: true, value: null });
        })
        .catch(() => {
          send({ type: "fatal" });
          process.exit(1);
        });
    } else if (m.type === "invoke") g.__invoke(m.id, m.kind, m.name, m.input);
    else if (m.type === "event") g.__event(m.id, m.topic, m.event);
    else if (m.type === "reply") g.__settle(m.id, m.ok, m.value);
    else if (m.type === "stop") process.exit();
  } catch {
    send({ type: "fatal" });
    process.exit(1);
  }
});
