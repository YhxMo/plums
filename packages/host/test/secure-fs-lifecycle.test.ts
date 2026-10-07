import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SecureFsSink } from "../src/io.js";

const controlled = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: controlled.spawn,
}));
const platformDescriptor = Object.getOwnPropertyDescriptor(
  process,
  "platform",
)!;
afterEach(() => {
  Object.defineProperty(process, "platform", platformDescriptor);
  vi.useRealTimers();
  controlled.spawn.mockReset();
});
function helper() {
  // Exercise the native protocol on every platform without starting a process.
  Object.defineProperty(process, "platform", {
    ...platformDescriptor,
    value: "darwin",
  });
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
    kill: vi.fn(),
  });
  controlled.spawn.mockReturnValue(child);
  const rootPath = path.resolve("fixture");
  return {
    child,
    sink: new SecureFsSink("trusted-helper"),
    location: { rootPath, path: path.join(rootPath, "file") },
  };
}
it.each(["read", "list", "write"] as const)(
  "waits for all helper stdio before completing %s even when exit arrives first",
  async (operation) => {
    const { child, sink, location } = helper();
    let settled = false;
    const result = (
      operation === "write"
        ? sink.write({ ...location, data: new Uint8Array([1]) })
        : sink[operation](location)
    ).then((value) => {
      settled = true;
      return value;
    });
    try {
      if (operation === "read")
        child.stdout.emit("data", Buffer.from("prefix"));
      if (operation === "list")
        child.stdout.emit("data", Buffer.from('[{"name":"file",'));
      child.emit("exit", 0);
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);
      if (operation === "read")
        child.stdout.emit("data", Buffer.from("suffix"));
      if (operation === "list")
        child.stdout.emit("data", Buffer.from('"type":"file"}]'));
      child.emit("close", 0);
      if (operation === "read")
        expect(Buffer.from((await result) as Uint8Array).toString()).toBe(
          "prefixsuffix",
        );
      if (operation === "list")
        expect(await result).toEqual([{ name: "file", type: "file" }]);
      if (operation === "write") expect(await result).toBeUndefined();
    } finally {
      child.emit("close", 0);
      await result.catch(() => {});
    }
  },
);
it("refuses an unsuccessful helper close instead of returning partial output", async () => {
  const { child, sink, location } = helper();
  const result = sink.read(location),
    rejected = expect(result).rejects.toThrow("Filesystem operation failed");
  child.stdout.emit("data", Buffer.from("partial"));
  child.emit("exit", 1);
  child.emit("close", 1);
  await rejected;
});
it("retains the 30-second helper budget while waiting for stdio to close", async () => {
  vi.useFakeTimers();
  const { child, sink, location } = helper();
  const result = sink.read(location),
    rejected = expect(result).rejects.toThrow("Filesystem operation failed");
  void rejected.catch(() => {});
  child.emit("exit", 0);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  child.emit("close", 0);
  await rejected;
});
