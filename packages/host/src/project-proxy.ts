import http from "node:http";
import net from "node:net";
import { lookup } from "node:dns/promises";
import { publicAddress } from "./io.js";

export interface ProjectProxyOptions {
  hosts: readonly string[];
  resolve?: (host: string) => Promise<string[]>;
  connect?: typeof net.connect;
  audit(event: { host: string; port: number; allowed: boolean }): Promise<void>;
}
/** Per-entry CONNECT tunnel. DNS is checked once and the connection uses that address. */
export class ProjectProxy {
  private server: http.Server;
  private sockets = new Set<net.Socket>();
  private closed = false;
  private hosts: readonly string[];
  constructor(private options: ProjectProxyOptions) {
    this.hosts = options.hosts.map((value) => {
      const wildcard = value.startsWith("*."),
        parsed = new URL("https://" + (wildcard ? value.slice(2) : value));
      if (
        parsed.port ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash ||
        parsed.username ||
        parsed.password
      )
        throw Error("Invalid project proxy host");
      return (wildcard ? "*." : "") + parsed.hostname;
    });
    this.server = http.createServer({ maxHeaderSize: 8192 }, (_req, res) => {
      res.writeHead(403).end();
    });
    this.server.headersTimeout = 5000;
    this.server.on("connection", (socket) => this.track(socket));
    this.server.on("connect", (req, client, head) => {
      void this.tunnel(req.url ?? "", client as net.Socket, head).catch(() =>
        client.destroy(),
      );
    });
    this.server.on("clientError", (_error, socket) => socket.destroy());
  }
  private track(socket: net.Socket) {
    this.sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => this.sockets.delete(socket));
  }
  private async tunnel(authority: string, client: net.Socket, head: Buffer) {
    const match =
      /^([a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?):([0-9]{1,5})$/.exec(
        authority,
      );
    const host = match?.[1]?.toLowerCase() ?? "";
    const port = Number(match?.[2] ?? 0);
    let addresses: string[] = [];
    let allowed =
      port === 443 &&
      !!host &&
      host
        .split(".")
        .every((label) =>
          /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
        ) &&
      this.hosts.some((h) =>
        h.startsWith("*.")
          ? host.endsWith(h.slice(1)) && host !== h.slice(2)
          : host === h,
      );
    if (allowed) {
      try {
        addresses = await (
          this.options.resolve ??
          (async (h) => (await lookup(h, { all: true })).map((a) => a.address))
        )(host);
        allowed = addresses.length > 0 && addresses.every(publicAddress);
      } catch {
        allowed = false;
      }
    }
    try {
      await this.options.audit({ host, port, allowed });
    } catch {
      allowed = false;
    }
    if (!allowed || this.closed || client.destroyed) {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = (this.options.connect ?? net.connect)({
      host: addresses[0]!,
      port: 443,
    });
    this.track(upstream);
    upstream.setTimeout(10_000, () => upstream.destroy());
    client.once("close", () => upstream.destroy());
    upstream.once("error", () => client.destroy());
    upstream.once("close", () => client.destroy());
    upstream.once("connect", () => {
      if (this.closed || client.destroyed) {
        upstream.destroy();
        return;
      }
      upstream.setTimeout(0);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    });
  }
  async listen(): Promise<number> {
    if (this.closed) throw Error("Project proxy closed");
    if (!this.server.listening)
      await new Promise<void>((resolve, reject) => {
        this.server.once("error", reject);
        this.server.listen(0, "127.0.0.1", () => {
          this.server.off("error", reject);
          resolve();
        });
      });
    return (this.server.address() as net.AddressInfo).port;
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const socket of this.sockets) socket.destroy();
    if (this.server.listening)
      await new Promise<void>((resolve, reject) =>
        this.server.close((error) => (error ? reject(error) : resolve())),
      );
  }
}
