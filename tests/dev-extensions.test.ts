import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { developmentFiles } from "../scripts/dev-extensions.mjs";

const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "plums-dev-extensions-"));
  roots.push(root);
  mkdirSync(join(root, "examples"));
  writeFileSync(join(root, "examples/counter.js"), "export default {};\n");
  writeFileSync(join(root, "catalog.dev.json"), "[]\n");
  writeFileSync(join(root, "secret.txt"), "not served\n");
  return root;
}
/** Runs the middleware once and reports what it sent, or that it passed on. */
function request(root: string, url: string) {
  const sent: { status?: number; type?: string; body?: string } = {};
  let next = false;
  developmentFiles(root, ["examples", "catalog.dev.json"])(
    { method: "GET", url },
    {
      statusCode: 200,
      setHeader(name: string, value: string) {
        if (name === "Content-Type") sent.type = value;
      },
      end(body: Buffer | string) {
        sent.status = this.statusCode;
        sent.body = String(body);
      },
    },
    () => (next = true),
  );
  return { ...sent, next };
}

it("serves listed development files as they are, with their types", () => {
  const root = fixture();
  expect(request(root, "/examples/counter.js?t=1")).toEqual({
    status: 200,
    type: "text/javascript; charset=utf-8",
    body: "export default {};\n",
    next: false,
  });
  expect(request(root, "/catalog.dev.json").type).toBe(
    "application/json; charset=utf-8",
  );
});

it("leaves every other path to Vite", () => {
  const root = fixture();
  for (const url of [
    "/secret.txt",
    "/src/main.tsx",
    "/examples/missing.js",
    "/examples/../secret.txt",
    "/examples/%2e%2e/secret.txt",
    "/examples",
  ])
    expect(request(root, url)).toEqual({ next: true });
});
