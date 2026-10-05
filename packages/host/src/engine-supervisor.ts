import { spawn, type ChildProcess } from "node:child_process";
// This small process owns the process group even if the desktop broker exits abruptly.
let child: ChildProcess | undefined,
  stopping = false,
  finished = false;
let pendingBytes = 0;
const send = (message: unknown) => {
  if (process.connected) process.send?.(message);
};
function alive(): boolean {
  if (!child?.pid) return false;
  try {
    process.kill(process.platform === "win32" ? child.pid : -child.pid, 0);
    return true;
  } catch {
    return false;
  }
}
function kill(signal: NodeJS.Signals): void {
  if (!child?.pid) return;
  try {
    process.kill(process.platform === "win32" ? child.pid : -child.pid, signal);
  } catch {
    /* already gone */
  }
}
function finish(): void {
  if (finished) return;
  finished = true;
  send({ type: "exited" });
  process.disconnect?.();
}
function stop(): void {
  if (stopping) return;
  stopping = true;
  kill("SIGTERM");
  const deadline = Date.now() + 3000;
  const poll = () => {
    if (!alive()) {
      finish();
      return;
    }
    if (Date.now() >= deadline) {
      kill("SIGKILL");
      finish();
      return;
    }
    setTimeout(poll, 50);
  };
  poll();
}
process.on("disconnect", stop);
process.on("SIGTERM", stop);
process.on("message", (raw: unknown) => {
  const m = raw as { type: string; entry: string; cwd: string; data: string };
  if (m.type === "start" && !child && !stopping) {
    child = spawn(process.execPath, [m.entry], {
      cwd: m.cwd,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.on("error", stop);
    child.on("exit", stop);
    child.stdout!.on("data", (chunk: Buffer) => {
      if (!process.connected || stopping) return;
      pendingBytes += chunk.length;
      if (pendingBytes > 8 * 1024 * 1024) {
        stop();
        return;
      }
      child!.stdout!.pause();
      process.send?.({ type: "stdout", data: chunk.toString("base64") }, () => {
        pendingBytes -= chunk.length;
        child?.stdout?.resume();
      });
    });
    child.stderr!.on("data", () => {});
    child.stdin!.on("error", stop);
    send({ type: "spawned", pid: child.pid });
  } else if (m.type === "write" && child && !stopping) {
    if (
      typeof m.data !== "string" ||
      Buffer.byteLength(m.data) > 1024 * 1024 + 1
    ) {
      stop();
      return;
    }
    if (
      child.stdin!.writableLength + Buffer.byteLength(m.data) >
      8 * 1024 * 1024
    ) {
      stop();
      return;
    }
    child.stdin!.write(m.data);
  } else if (m.type === "stop") stop();
});
