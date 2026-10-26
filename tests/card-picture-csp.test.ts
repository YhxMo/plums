import { afterEach, expect, it, vi } from "vitest";
import config from "../src-tauri/tauri.conf.json";
import { roleCardPng } from "../src/agents/cardFile";
import type { Agent } from "../modules/agents/contract";

afterEach(() => vi.unstubAllGlobals());

/** The sources the native window lets an <img> load. */
const imgSources = () =>
  config.app.security.csp
    .split(";")
    .map((directive) => directive.trim().split(/\s+/))
    .find(([name]) => name === "img-src")!
    .slice(1);

it("draws the default plum from a source the native CSP allows", async () => {
  const loaded: string[] = [];
  vi.stubGlobal(
    "Image",
    class {
      onerror?: () => void;
      set src(value: string) {
        loaded.push(value);
        queueMicrotask(() => this.onerror?.());
      }
    },
  );
  const agent = { name: "默认头像", sessions: [] } as unknown as Agent;
  await expect(roleCardPng(agent)).rejects.toThrow("无法读取头像。");
  const [src] = loaded;
  const scheme = `${src.slice(0, src.indexOf(":"))}:`;
  expect(imgSources()).toContain(scheme);
});
