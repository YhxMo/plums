import net from "node:net";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import {
  ProjectProxy,
  type ProjectProxyOptions,
} from "../src/project-proxy.js";

const proxies: ProjectProxy[] = [],
  clients: net.Socket[] = [];
afterEach(async () => {
  clients.splice(0).forEach((s) => s.destroy());
  await Promise.all(proxies.splice(0).map((p) => p.close()));
});
async function fixture(extra: Partial<ProjectProxyOptions> = {}) {
  const upstream = new PassThrough() as PassThrough & {
    setTimeout: ReturnType<typeof vi.fn>;
  };
  upstream.setTimeout = vi.fn(() => upstream);
  const connect = vi.fn(() => {
    queueMicrotask(() => upstream.emit("connect"));
    return upstream;
  });
  const audit = vi.fn(async () => {}),
    resolve = vi.fn(async () => ["8.8.8.8"]);
  const proxy = new ProjectProxy({
    hosts: ["packages.fixture.test", "*.mirror.fixture.test"],
    audit,
    resolve,
    connect: connect as unknown as typeof net.connect,
    ...extra,
  });
  proxies.push(proxy);
  const port = await proxy.listen();
  const request = (authority: string, payload = "") =>
    new Promise<string>((done, reject) => {
      const socket = net.connect(port, "127.0.0.1");
      clients.push(socket);
      socket.once("error", reject);
      let data = "";
      socket.on("data", (chunk) => {
        data += chunk;
        if (data.includes("\r\n\r\n")) done(data);
      });
      socket.once("connect", () =>
        socket.write(
          `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n${payload}`,
        ),
      );
    });
  return { proxy, request, audit, connect, resolve, upstream };
}
it.each([
  "other.fixture.test:443",
  "packages.fixture.test:80",
  "user:password@packages.fixture.test:443",
  "mirror.fixture.test:443",
  "evilmirror.fixture.test:443",
])("denies %s before connecting", async (authority) => {
  const f = await fixture();
  expect(await f.request(authority)).toContain("403");
  expect(f.connect).not.toHaveBeenCalled();
  expect(f.audit).toHaveBeenCalledOnce();
});
it.each([["127.0.0.1"], ["10.0.0.1"], ["::1"], ["8.8.8.8", "192.168.1.1"], []])(
  "refuses non-public/mixed resolution %s",
  async (...addresses) => {
    const f = await fixture({ resolve: async () => addresses.flat() });
    expect(await f.request("packages.fixture.test:443")).toContain("403");
    expect(f.connect).not.toHaveBeenCalled();
  },
);
it.each(["packages.fixture.test:443", "child.mirror.fixture.test:443"])(
  "pins an approved connection to its validated address: %s",
  async (host) => {
    const f = await fixture();
    expect(await f.request(host)).toContain("200 Connection Established");
    expect(f.connect).toHaveBeenCalledWith({ host: "8.8.8.8", port: 443 });
    expect(f.audit).toHaveBeenCalledWith({
      host: host.split(":")[0],
      port: 443,
      allowed: true,
    });
    await f.proxy.close();
    expect(f.upstream.destroyed).toBe(true);
  },
);
it("fails closed when connection auditing fails", async () => {
  const f = await fixture({
    audit: async () => {
      throw Error("fixture");
    },
  });
  expect(await f.request("packages.fixture.test:443")).toContain("403");
  expect(f.connect).not.toHaveBeenCalled();
});
it("normalizes approved hosts with an explicit HTTPS port", async () => {
  const f = await fixture({ hosts: ["PACKAGES.fixture.test:443"] });
  expect(await f.request("packages.fixture.test:443")).toContain(
    "200 Connection Established",
  );
  expect(f.connect).toHaveBeenCalledWith({ host: "8.8.8.8", port: 443 });
});
