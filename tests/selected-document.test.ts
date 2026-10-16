import type { SelectedDocumentRequest } from "../modules/sdk";
import { expect, test } from "vitest";
import { SyntheticDocuments } from "./fixtures/synthetic-documents";
const request = (handle: string, maxBytes = 100) => ({ handle, maxBytes });
test("only explicit selected owner can read and declined selection creates no binding", async () => {
  const m = new SyntheticDocuments();
  expect(m.select("a", null)).toBeNull();
  expect(await m.read("a", request("missing"))).toEqual({
    status: "rejected",
    reason: "denied",
  });
  const h = m.select("a", "plum")!;
  expect(await m.read("b", request(h))).toEqual({
    status: "rejected",
    reason: "denied",
  });
  expect(await m.read("a", request(h))).toEqual({
    status: "read",
    text: "plum",
    bytes: 4,
  });
});
test("revoke and reselect never revive old handles", async () => {
  const m = new SyntheticDocuments();
  const h = m.select("a", "one")!;
  m.revoke("a", h);
  const next = m.select("a", "two")!;
  expect(next).not.toBe(h);
  expect((await m.read("a", request(h))).status).toBe("rejected");
  expect(await m.read("a", request(next))).toEqual({
    status: "read",
    text: "two",
    bytes: 3,
  });
  m.revokeOwner("a");
  expect((await m.read("a", request(next))).status).toBe("rejected");
});
test("inflight revoke, disable and cancel cannot deliver text", async () => {
  for (const action of ["revoke", "disable", "cancel"]) {
    const m = new SyntheticDocuments();
    const h = m.select("a", "secret synthetic")!;
    const c = new AbortController();
    let release!: () => void;
    const pending = m.read(
      "a",
      request(h),
      c.signal,
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    if (action === "revoke") m.revokeOwner("a");
    if (action === "disable") m.available = false;
    if (action === "cancel") c.abort();
    release();
    const result = await pending;
    expect(result.status).not.toBe("read");
    expect(result).not.toHaveProperty("text");
  }
});
test("unavailable and pre-cancel have explicit non-data outcomes", async () => {
  const m = new SyntheticDocuments();
  const h = m.select("a", "plum")!;
  m.available = false;
  expect(await m.read("a", request(h))).toEqual({
    status: "rejected",
    reason: "unavailable",
  });
  m.available = true;
  const c = new AbortController();
  c.abort();
  expect(await m.read("a", request(h), c.signal)).toEqual({
    status: "cancelled",
  });
});
test("validates requests and enforces UTF8 size without truncation", async () => {
  const m = new SyntheticDocuments();
  const h = m.select("a", "梅子")!;
  for (const maxBytes of [0, 1.5, 65537, NaN])
    expect(await m.read("a", request(h, maxBytes))).toEqual({
      status: "rejected",
      reason: "invalid-request",
    });
  expect(await m.read("a", request(h, 5))).toEqual({
    status: "rejected",
    reason: "too-large",
  });
  expect(await m.read("a", request(h, 6))).toEqual({
    status: "read",
    text: "梅子",
    bytes: 6,
  });
});
test("binding budget refuses new selection without evicting existing grants", async () => {
  const m = new SyntheticDocuments();
  const a = m.select("a", "one")!;
  m.select("a", "two");
  expect(() => m.select("a", "three")).toThrow("resource-limit");
  expect((await m.read("a", request(a))).status).toBe("read");
  expect(m.select("b", "own")).toBeTypeOf("string");
});
test("unknown result hides error details and never retries", async () => {
  const m = new SyntheticDocuments();
  const h = m.select("a", "plum")!;
  let calls = 0;
  expect(
    await m.read("a", request(h), undefined, async () => {
      calls++;
      throw Error("synthetic private path");
    }),
  ).toEqual({ status: "unknown" });
  expect(calls).toBe(1);
});
test("request snapshot prevents async caller mutation and unrelated owner revoke", async () => {
  const m = new SyntheticDocuments();
  const a = m.select("a", "plum")!,
    b = m.select("b", "pear")!;
  const q = request(a, 4);
  const result = await m.read("a", q, undefined, async () => {
    q.handle = b;
    q.maxBytes = 1;
    m.revoke("b", a);
  });
  expect(result).toEqual({ status: "read", text: "plum", bytes: 4 });
});
test("already delivered data remains a receipt after later revocation", async () => {
  const m = new SyntheticDocuments();
  const h = m.select("a", "plum")!;
  const result = await m.read("a", request(h));
  m.revokeOwner("a");
  expect(result).toEqual({ status: "read", text: "plum", bytes: 4 });
  expect((await m.read("a", request(h))).status).toBe("rejected");
});

test("malformed untyped requests return invalid-request without throwing", async () => {
  const m = new SyntheticDocuments();
  for (const value of [null, undefined, [], 1, {}, { handle: 3, maxBytes: 4 }])
    expect(
      await m.read("a", value as unknown as SelectedDocumentRequest),
    ).toEqual({
      status: "rejected",
      reason: "invalid-request",
    });
});
