import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { fileURLToPath } from "node:url";
import type {
  EgressSink,
  EgressRequest,
  EgressResult,
  FsSink,
  FsLocation,
  FsEntry,
  SecretStore,
} from "@plums/core";
import type { DesktopContribution } from "@plums/sdk";

export interface IoContext {
  signal: AbortSignal;
  packageId: string;
  permissionId: string;
  contribution?: DesktopContribution;
  secrets: SecretStore;
  onChunk?: (chunk: string) => void;
}
export const ioContext = new AsyncLocalStorage<IoContext>();
export type DnsMode = "system" | "cloudflare";
const LIMIT = 20 * 1024 * 1024;
export function publicAddress(address: string): boolean {
  if (net.isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number) as [
      number,
      number,
      number,
    ];
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (net.isIP(address) === 6) {
    const first = parseInt(address.split(":")[0]!, 16);
    const second = parseInt(address.split(":")[1] || "0", 16);
    return (
      first >= 0x2000 &&
      first < 0x3fff &&
      first !== 0x2002 &&
      !(first === 0x2001 && (second < 0x200 || second === 0xdb8))
    );
  }
  return false;
}
export class HttpsSink implements EgressSink {
  constructor(private dnsMode: DnsMode = "system") {}
  async send(request: EgressRequest): Promise<EgressResult> {
    const context = ioContext.getStore();
    if (!context || context.signal.aborted)
      throw Error("Transport context missing");
    const url = new URL(request.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      net.isIP(url.hostname)
    )
      throw Error("Destination refused");
    const resolved =
      this.dnsMode === "cloudflare"
        ? await encryptedLookup(url.hostname, context.signal)
        : await lookup(url.hostname, { all: true });
    if (!resolved.length || resolved.some((a) => !publicAddress(a.address)))
      throw Error("Destination refused");
    const pinned = resolved[0]!;
    const headers: Record<string, string> = { ...request.headers };
    for (const k of Object.keys(headers))
      if (
        /^(host|connection|content-length|transfer-encoding|proxy-authorization|proxy-connection)$/i.test(
          k,
        )
      )
        throw Error("Header refused");
    for (const binding of context.contribution?.credentials ?? [])
      if (binding.permissionId === context.permissionId) {
        const secret = await context.secrets.get(
          `secret:${context.packageId}/${binding.setting}`,
        );
        if (secret === undefined || /[\r\n\0]/.test(secret))
          throw Error("Credential unavailable");
        for (const name of Object.keys(headers))
          if (name.toLowerCase() === binding.header.toLowerCase())
            delete headers[name];
        headers[binding.header] = (binding.prefix ?? "") + secret;
      }
    if (context.signal.aborted) throw Error("Cancelled");
    return new Promise((resolve, reject) => {
      const fail = () => reject(Error("HTTPS request failed"));
      const req = https.request(
        url,
        {
          method: request.method ?? "GET",
          headers,
          signal: context.signal,
          lookup: (_host, options, callback) => {
            if (options.all) callback(null, [pinned]);
            else callback(null, pinned.address, pinned.family);
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let total = 0;
          const decoder = new TextDecoder();
          res.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > LIMIT) {
              req.destroy();
              fail();
              return;
            }
            chunks.push(chunk);
            if (request.stream)
              context.onChunk?.(decoder.decode(chunk, { stream: true }));
          });
          res.on("error", fail);
          res.on("end", () => {
            if (request.stream) {
              const last = decoder.decode();
              if (last) context.onChunk?.(last);
            }
            const responseHeaders = Object.fromEntries(
              Object.entries(res.headers).map(([k, v]) => [
                k,
                Array.isArray(v) ? v.join(", ") : (v ?? ""),
              ]),
            );
            const result: EgressResult = {
              status: res.statusCode ?? 0,
              headers: responseHeaders,
              body: Buffer.concat(chunks).toString("utf8"),
            };
            if (
              res.statusCode &&
              res.statusCode >= 300 &&
              res.statusCode < 400 &&
              res.headers.location
            )
              result.redirectTo = res.headers.location;
            resolve(result);
          });
        },
      );
      req.setTimeout(60_000, () => {
        req.destroy();
        fail();
      });
      const timer = setTimeout(() => {
        req.destroy();
        fail();
      }, 120_000);
      req.on("close", () => clearTimeout(timer));
      req.on("error", fail);
      if (request.body !== undefined) {
        if (Buffer.byteLength(request.body) > LIMIT) {
          req.destroy();
          fail();
          return;
        }
        req.write(request.body);
      }
      req.end();
    });
  }
}
export class SecureFsSink implements FsSink {
  constructor(
    private helper = fileURLToPath(new URL("./secure-fs", import.meta.url)),
  ) {}
  private execute(
    operation: string,
    location: FsLocation,
    data?: Uint8Array,
  ): Promise<Buffer> {
    const signal = ioContext.getStore()?.signal;
    if (process.platform !== "darwin" || signal?.aborted)
      return Promise.reject(Error("Filesystem unavailable"));
    const relative = path.relative(location.rootPath, location.path) || ".";
    if (
      relative === ".." ||
      relative.startsWith(".." + path.sep) ||
      path.isAbsolute(relative)
    )
      return Promise.reject(Error("Path refused"));
    if (data && data.length > LIMIT)
      return Promise.reject(Error("Write exceeds limit"));
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.helper,
        [operation, location.rootPath, relative],
        { stdio: ["pipe", "pipe", "ignore"], env: {}, signal },
      );
      const chunks: Buffer[] = [];
      let total = 0;
      const fail = () => reject(Error("Filesystem operation failed"));
      child.stdout.on("data", (b: Buffer) => {
        total += b.length;
        if (total > LIMIT) {
          child.kill("SIGKILL");
          fail();
        } else chunks.push(b);
      });
      child.on("error", fail);
      child.stdin.on("error", () => {});
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        fail();
      }, 30_000);
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(Buffer.concat(chunks));
        else fail();
      });
      child.stdin.end(data);
    });
  }
  async read(req: FsLocation): Promise<Uint8Array> {
    return new Uint8Array(await this.execute("read", req));
  }
  async write(req: FsLocation & { data: Uint8Array }): Promise<void> {
    await this.execute("write", req, req.data);
  }
  async list(req: FsLocation): Promise<FsEntry[]> {
    return JSON.parse(
      (await this.execute("list", req)).toString("utf8"),
    ) as FsEntry[];
  }
}
/** Fixed, TLS-verified DNS infrastructure; never receives credentials or request bodies. */
async function encryptedLookup(
  host: string,
  signal: AbortSignal,
): Promise<{ address: string; family: number }[]> {
  const responses = await Promise.all(
    [1, 28].map(
      (type) =>
        new Promise<{ address: string; family: number }[]>(
          (resolve, reject) => {
            const req = https.get(
              `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
              {
                headers: { Accept: "application/dns-json" },
                signal,
                lookup: (_name, options, cb) => {
                  if (options.all)
                    cb(null, [{ address: "1.1.1.1", family: 4 }]);
                  else cb(null, "1.1.1.1", 4);
                },
              },
              (res) => {
                let body = "";
                res.on("data", (b: Buffer) => {
                  body += b.toString("utf8");
                  if (body.length > 65536) req.destroy();
                });
                res.on("error", () => reject(Error("DNS unavailable")));
                res.on("end", () => {
                  try {
                    if (res.statusCode !== 200) throw Error();
                    const data = JSON.parse(body) as {
                      Status: number;
                      Answer?: { type: number; data: string }[];
                    };
                    if (data.Status !== 0) throw Error();
                    resolve(
                      (data.Answer ?? [])
                        .filter((a) => a.type === type)
                        .map((a) => ({
                          address: a.data,
                          family: type === 1 ? 4 : 6,
                        })),
                    );
                  } catch {
                    reject(Error("DNS unavailable"));
                  }
                });
              },
            );
            const timer = setTimeout(() => req.destroy(), 10000);
            req.on("close", () => clearTimeout(timer));
            req.on("error", () => reject(Error("DNS unavailable")));
          },
        ),
    ),
  );
  return responses.flat();
}
