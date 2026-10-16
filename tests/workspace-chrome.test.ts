import { expect, test } from "vitest";
import { createWorkspaceChrome } from "../modules/sdk";
import { createChromeStore } from "../src/shell/workspace-chrome-store";

test("a late view cleanup cannot disconnect a replacement workspace", () => {
  const chrome = createWorkspaceChrome("test.entity");
  const revealed: string[] = [];
  const releaseOld = chrome.connect((id) => revealed.push(`old:${id}`));
  const releaseCurrent = chrome.connect((id) => revealed.push(`current:${id}`));
  chrome.publish({ title: "Replacement", contextOwner: "replacement.owner" });
  releaseOld();
  chrome.navigation.reveal("entity");
  expect(revealed).toEqual(["current:entity"]);
  expect(chrome.getSnapshot().title).toBe("Replacement");
  releaseCurrent();
  chrome.navigation.reveal("after-close");
  expect(chrome.getSnapshot()).toEqual({});
  expect(revealed).toEqual(["current:entity"]);
});

test("independent workspaces keep separate snapshots and release subscriptions", () => {
  const first = createWorkspaceChrome("test.entity");
  const second = createWorkspaceChrome("test.entity");
  const titles: (string | undefined)[] = [];
  const release = first.subscribe(() => titles.push(first.getSnapshot().title));
  first.publish({ title: "First" });
  second.publish({ title: "Second" });
  release();
  first.publish({ title: "After release" });
  expect(titles).toEqual(["First"]);
  expect(second.getSnapshot().title).toBe("Second");
});

test("chrome failures become stable failure snapshots without escaping render", () => {
  const reason = new Error("snapshot failure");
  const chrome = {
    getSnapshot() {
      throw reason;
    },
    subscribe() {
      throw new Error("must not subscribe after failed read");
    },
  };
  const store = createChromeStore(chrome, () => {});
  const failed = store.getSnapshot();
  expect(failed.failure?.reason).toBe(reason);
  expect(store.getSnapshot()).toBe(failed);
  expect(() => store.subscribe(() => {})()).not.toThrow();
});

test("released chrome subscriptions ignore late notifications and report cleanup errors", () => {
  let notify: () => void = () => {};
  const failures: unknown[] = [];
  const calls: string[] = [];
  const state = { title: "Receiver state" };
  const chrome = {
    state,
    getSnapshot() {
      return this.state;
    },
    subscribe(listener: () => void) {
      notify = listener;
      return () => {
        throw new Error("cleanup failure");
      };
    },
  };
  const store = createChromeStore(chrome, (reason) => failures.push(reason));
  expect(store.getSnapshot().state).toBe(state);
  const release = store.subscribe(() => calls.push("notified"));
  notify();
  release();
  notify();
  expect(calls).toEqual(["notified"]);
  expect(failures).toEqual([new Error("cleanup failure")]);
});
