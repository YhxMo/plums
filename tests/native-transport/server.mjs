// Synthetic loopback-only service. Run with an ignored output directory argument.
import http from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const output = process.argv[2];
if (!output) throw Error("Provide isolated output directory");
mkdirSync(output, { recursive: true });
/** @type {Record<string, number>} */
const hits = {};
const server = http.createServer(async (req, res) => {
  const path = req.url ?? "/";
  hits[path] = (hits[path] ?? 0) + 1;
  writeFileSync(join(output, "hits.json"), JSON.stringify(hits));
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 4096) {
      res.writeHead(413).end();
      return;
    }
  }
  /** @param {number} status @param {string} text */
  const reply = (status, text) => {
    if (!res.destroyed) {
      res.writeHead(status, {
        "Content-Type": "text/plain",
        "Content-Length": Buffer.byteLength(text),
      });
      res.end(text);
    }
  };
  if (path === "/echo") reply(200, `echo:${body}`);
  else if (path === "/delay") setTimeout(() => reply(200, "late"), 2000);
  else if (path === "/slow") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    let n = 0;
    const timer = setInterval(() => {
      if (res.destroyed) {
        clearInterval(timer);
        return;
      }
      res.write("x");
      if (++n === 5) {
        clearInterval(timer);
        res.end();
      }
    }, 300);
  } else if (path === "/redirect") {
    res.writeHead(302, { Location: "http://127.0.0.1:18765/should-not-hit" });
    res.end();
  } else if (path === "/oversize") reply(200, "x".repeat(9000));
  else if (path === "/chunked") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("x".repeat(9000));
    res.end();
  } else if (path === "/stats") reply(200, JSON.stringify(hits));
  else if (path === "/report") {
    const result = JSON.parse(body);
    if (!["macos", "android"].includes(result.platform?.os))
      throw Error("Unexpected report");
    writeFileSync(
      join(output, `${result.platform.os}.json`),
      JSON.stringify(result, null, 2),
    );
    reply(200, "recorded");
  } else reply(404, "unexpected");
});
server.listen(18765, "127.0.0.1", () =>
  console.log("Synthetic loopback service listening"),
);
