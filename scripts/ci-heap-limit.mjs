import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const bytes = Number(
  execFileSync("/usr/sbin/sysctl", ["-n", "hw.memsize"], {
    encoding: "utf8",
  }).trim(),
);
if (!Number.isSafeInteger(bytes) || bytes <= 0)
  throw Error("Invalid runner memory");
const heap = Math.min(4096, Math.floor((bytes / 1048576) * 0.4));
appendFileSync(process.env.GITHUB_OUTPUT, `heap=${heap}\n`);
console.log(
  JSON.stringify({ memoryBytes: bytes, heapMiB: heap, unitWorkers: 2 }),
);
