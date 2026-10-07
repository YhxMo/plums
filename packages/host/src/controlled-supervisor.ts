import { spawn, execFile, type ChildProcess } from "node:child_process";
let child: ChildProcess | undefined,
  stopping = false,
  exited = false,
  timer: NodeJS.Timeout | undefined,
  sampler: NodeJS.Timeout | undefined,
  sampling = false;
const send = (m: unknown) => {
  if (process.connected) process.send?.(m);
};
const kill = (signal: NodeJS.Signals) => {
  if (child?.pid)
    try {
      process.kill(-child.pid, signal);
    } catch {}
};
const finish = () => {
  clearTimeout(timer);
  clearInterval(sampler);
  if (process.connected) process.disconnect();
};
function stop() {
  if (stopping) return;
  stopping = true;
  if (!child || exited) return finish();
  kill("SIGTERM");
  timer = setTimeout(() => kill("SIGKILL"), 3000);
}
process.on("disconnect", stop);
process.on("SIGTERM", stop);
process.on("message", (raw: unknown) => {
  const m = raw as {
    type: string;
    program: string;
    args: string[];
    profile: string;
    cwd: string;
    data: string;
  };
  if (m.type === "start" && !child && !stopping) {
    child = spawn(
      "/usr/bin/sandbox-exec",
      ["-p", m.profile, m.program, ...m.args],
      { cwd: m.cwd, env: {}, detached: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    child.on("error", () => {
      send({ type: "failed" });
      stop();
      if (!child?.pid) finish();
    });
    child.on("spawn", () => {
      send({ type: "spawned", pid: child!.pid });
      sampler = setInterval(() => {
        if (sampling || exited || stopping) return;
        sampling = true;
        execFile(
          "/bin/ps",
          ["-o", "rss=", "-o", "time=", "-p", String(child!.pid)],
          { env: {}, timeout: 1000, maxBuffer: 1024 },
          (error, output) => {
            sampling = false;
            if (exited || stopping) return;
            const parts = output.trim().split(/\s+/);
            const kib = Number(parts[0]);
            const time = parts[1]?.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
            if (error || !Number.isFinite(kib) || kib <= 0 || !time)
              return stop();
            const cpuMs =
              (Number(time[1] ?? 0) * 3600 +
                Number(time[2]) * 60 +
                Number(time[3])) *
              1000;
            const rss = kib * 1024;
            send({ type: "usage", rss, cpuMs });
            if (rss > 256 * 1024 * 1024) stop();
          },
        );
      }, 250);
    });
    child.on("exit", (code, signal) => {
      exited = true;
      send({ type: "exited", code, signal });
      finish();
    });
    for (const [stream, name] of [
      [child.stdout, "stdout"],
      [child.stderr, "stderr"],
    ] as const)
      stream!.on("data", (data: Buffer) => {
        if (!process.connected) return stop();
        stream!.pause();
        process.send?.({ type: name, data: data.toString("base64") }, () =>
          stream!.resume(),
        );
      });
    child.stdin!.on("error", stop);
  } else if (m.type === "write" && child && !stopping) {
    if (
      typeof m.data !== "string" ||
      Buffer.byteLength(m.data) > 1024 * 1024 + 1 ||
      child.stdin!.writableLength > 8 * 1024 * 1024
    )
      return stop();
    child.stdin!.write(m.data);
  } else if (m.type === "stop") stop();
});
