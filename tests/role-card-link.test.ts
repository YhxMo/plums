import { afterEach, expect, it, vi } from "vitest";
import { readRoleCardLink } from "../modules/agents/role-card";
afterEach(() => vi.unstubAllGlobals());
function source(chunks: Uint8Array[]) {
  vi.stubGlobal("location", {
    href: "http://localhost/",
    origin: "http://localhost",
  });
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  const fetcher = vi.fn(async () => new Response(stream));
  vi.stubGlobal("fetch", fetcher);
  return { cancel, fetcher };
}
it("stops streaming on actual byte overflow before consuming the remainder", async () => {
  const chunks = [
    new Uint8Array(16000).fill(32),
    new Uint8Array(16001).fill(32),
    new Uint8Array(100000),
  ];
  const { cancel } = source(chunks);
  await expect(
    readRoleCardLink("/card", new AbortController().signal),
  ).rejects.toThrow("32 KB");
  expect(cancel).toHaveBeenCalledOnce();
  expect(chunks).toHaveLength(1);
});
it("decodes split UTF-8 and validates normal cards without permitting redirects", async () => {
  const raw = '{"name":"角色"}';
  const bytes = new TextEncoder().encode(raw);
  const { fetcher } = source([...bytes].map((byte) => Uint8Array.of(byte)));
  await expect(
    readRoleCardLink("/card", new AbortController().signal),
  ).resolves.toBe(raw);
  expect(fetcher).toHaveBeenCalledWith(
    new URL("http://localhost/card"),
    expect.objectContaining({ redirect: "error" }),
  );
});
it("rejects external links without fetching", async () => {
  const { fetcher } = source([]);
  await expect(
    readRoleCardLink(
      "https://external.invalid/card",
      new AbortController().signal,
    ),
  ).rejects.toThrow("应用内链接");
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["{broken", '{"name":""}'])("rejects invalid card %s", async (raw) => {
  source([new TextEncoder().encode(raw)]);
  await expect(
    readRoleCardLink("/card", new AbortController().signal),
  ).rejects.toThrow();
});

it.each(["timeout", "cancel"])(
  "interrupts a stalled body after response headers: %s",
  async (mode) => {
    vi.useFakeTimers();
    vi.stubGlobal("location", {
      href: "http://localhost/",
      origin: "http://localhost",
    });
    let bodyStarted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url, options) =>
          new Response(
            new ReadableStream({
              start(controller) {
                options.signal.addEventListener(
                  "abort",
                  () =>
                    controller.error(new DOMException("Aborted", "AbortError")),
                  { once: true },
                );
              },
              pull() {
                bodyStarted = true;
              },
            }),
          ),
      ),
    );
    const controller = new AbortController();
    try {
      const pending = readRoleCardLink("/card", controller.signal);
      const rejected = expect(pending).rejects.toThrow(
        mode === "timeout" ? "超时" : "Aborted",
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(bodyStarted).toBe(true);
      if (mode === "timeout") await vi.advanceTimersByTimeAsync(10000);
      else controller.abort();
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  },
);
