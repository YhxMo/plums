import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { MemorySecretStore } from "@plumsjs/core";
import { HttpsSink, ioContext, type DnsMode } from "../src/io.js";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
const dnsQueries: { url: string; headers: unknown }[] = [];
const requests: { url: URL; options: any; body: string }[] = [];
let dnsAddress = "104.21.1.1",
  dnsFails = false;
beforeEach(() => {
  dnsQueries.length = 0;
  requests.length = 0;
  dnsAddress = "104.21.1.1";
  dnsFails = false;
  vi.mocked(lookup).mockResolvedValue([
    { address: "198.18.0.84", family: 4 },
    { address: "2001:2::8c", family: 6 },
  ]);
  vi.spyOn(https, "get").mockImplementation(((
    url: string,
    options: any,
    callback: any,
  ) => {
    dnsQueries.push({ url, headers: options.headers });
    const req = new EventEmitter() as any;
    req.destroy = () => {
      req.emit("error", new Error("private DNS details"));
      req.emit("close");
    };
    queueMicrotask(() => {
      if (dnsFails) {
        req.destroy();
        return;
      }
      const res = new EventEmitter() as any;
      res.statusCode = 200;
      callback(res);
      const type = Number(new URL(url).searchParams.get("type"));
      res.emit(
        "data",
        Buffer.from(
          JSON.stringify({
            Status: 0,
            Answer: type === 1 ? [{ type: 1, data: dnsAddress }] : [],
          }),
        ),
      );
      res.emit("end");
      req.emit("close");
    });
    return req;
  }) as any);
  vi.spyOn(https, "request").mockImplementation(((
    url: URL,
    options: any,
    callback: any,
  ) => {
    const record = { url, options, body: "" };
    requests.push(record);
    const req = new EventEmitter() as any;
    req.setTimeout = () => {};
    req.destroy = () => {
      req.emit("error", new Error("fake-private transport details"));
      req.emit("close");
    };
    req.write = (body: string) => {
      record.body += body;
    };
    req.end = () =>
      queueMicrotask(() => {
        const res = new EventEmitter() as any;
        res.statusCode = 200;
        res.headers = {};
        callback(res);
        res.emit("data", Buffer.from('{"ok":true}'));
        res.emit("end");
        req.emit("close");
      });
    return req;
  }) as any);
});
afterEach(() => vi.restoreAllMocks());
function send(mode?: DnsMode) {
  return ioContext.run(
    {
      signal: new AbortController().signal,
      packageId: "model",
      permissionId: "model-api",
      secrets: new MemorySecretStore(),
    },
    () =>
      new HttpsSink(mode).send({
        url: "https://opencode.ai/zen/go/v1/chat/completions",
        method: "POST",
        headers: { Authorization: "Bearer fake-private-key" },
        body: "fake-private-conversation",
      }),
  );
}
it("automatically resolves proxy fake addresses and sends credentials only to the original HTTPS target", async () => {
  expect(await send()).toMatchObject({ status: 200 });
  expect(dnsQueries).toHaveLength(2);
  expect(requests).toHaveLength(1);
  expect(JSON.stringify(dnsQueries)).not.toContain("fake-private");
  expect(requests[0]!.url.hostname).toBe("opencode.ai");
  expect(requests[0]!.options.headers.Authorization).toBe(
    "Bearer fake-private-key",
  );
  const cb = vi.fn();
  requests[0]!.options.lookup("opencode.ai", {}, cb);
  expect(cb).toHaveBeenCalledWith(null, "104.21.1.1", 4);
});
it("uses public system DNS without an extra query", async () => {
  vi.mocked(lookup).mockResolvedValue([{ address: "104.21.1.1", family: 4 }]);
  await send();
  expect(dnsQueries).toEqual([]);
  expect(requests).toHaveLength(1);
});
it("falls back when system DNS is unavailable", async () => {
  vi.mocked(lookup).mockRejectedValue(Error("private resolver failure"));
  await send();
  expect(dnsQueries).toHaveLength(2);
  expect(requests).toHaveLength(1);
});
it("preserves explicit system DNS and reports a refusal before sending", async () => {
  await expect(send("system")).rejects.toMatchObject({
    reason: "DNS_RESERVED_ADDRESS",
    executionState: "not_started",
  });
  expect(dnsQueries).toEqual([]);
  expect(requests).toEqual([]);
});
it.each(["127.0.0.1", "192.168.1.2", "198.18.0.5", "2001:2::1"])(
  "refuses %s returned by encrypted DNS",
  async (address) => {
    dnsAddress = address;
    await expect(send()).rejects.toMatchObject({
      reason: "DNS_RESERVED_ADDRESS",
      executionState: "not_started",
    });
    expect(requests).toEqual([]);
  },
);
it("does not send a model request if encrypted DNS fails", async () => {
  dnsFails = true;
  await expect(send()).rejects.toMatchObject({
    reason: "DNS_FAILED",
    executionState: "not_started",
  });
  expect(requests).toEqual([]);
});
it("uses an explicit encrypted resolver without a system query", async () => {
  vi.mocked(lookup).mockClear();
  await send("cloudflare");
  expect(lookup).not.toHaveBeenCalled();
  expect(dnsQueries).toHaveLength(2);
});
it("does not repeat an HTTPS request after a transport failure", async () => {
  vi.mocked(https.request).mockImplementation((() => {
    const req = new EventEmitter() as any;
    req.setTimeout = () => {};
    req.write = () => {};
    req.end = () =>
      queueMicrotask(() => {
        req.emit("error", Error("private timeout"));
        req.emit("close");
      });
    return req;
  }) as any);
  await expect(send()).rejects.toThrow("HTTPS request failed");
  expect(https.request).toHaveBeenCalledTimes(1);
});
