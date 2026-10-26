// Drives main.js with a fake ctx; no network.
import assert from "node:assert/strict";
import process from "node:process";
import { pathToFileURL } from "node:url";

const { default: main } = await import(pathToFileURL(process.argv[2]).href);

function setup(handler) {
  const calls = [];
  let service;
  main.activate({
    provide(name, version, value) {
      assert.equal(name, "chat");
      assert.equal(version, 1);
      service = value;
    },
    async platform(capability, payload, signal) {
      calls.push({ capability, payload, body: JSON.parse(payload.body) });
      return handler(payload, signal, calls.length);
    },
  });
  return { service, calls };
}
const ok = (content, finish = "stop") => ({
  status: 200,
  body: JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content, reasoning_content: "hmm" }, finish_reason: finish }] }),
});
const live = () => new AbortController().signal;
const ask = (s, input = "x", model = "kimi-k3") => s.reply({ model, history: [], input }, live());

// 1. Models and request shape.
{
  const t = setup(() => ok("你好！"));
  assert.ok(t.service.models().every((m) => m.id.length <= 256 && !m.id.includes("/")));
  const reply = await t.service.reply(
    {
      model: "glm-5.3",
      instructions: "你是小助手。",
      history: [
        { role: "agent", text: "orphan" },
        { role: "user", text: "a" },
        { role: "user", text: "b" },
        { role: "agent", text: "c" },
        { role: "agent", text: "  " },
      ],
      input: "d",
    },
    live(),
  );
  assert.equal(reply, "你好！");
  const [call] = t.calls;
  assert.equal(call.capability, "credential.request");
  assert.deepEqual(Object.keys(call.payload).sort(), ["binding", "body", "version"]);
  assert.equal(call.payload.binding, "chat");
  assert.equal(typeof call.payload.body, "string");
  assert.deepEqual(call.body, {
    model: "glm-5.3",
    messages: [
      { role: "system", content: "你是小助手。" },
      { role: "user", content: "a\n\nb" },
      { role: "assistant", content: "c" },
      { role: "user", content: "d" },
    ],
    max_tokens: 1024,
    stream: false,
  });
}

// 2. Errors, truncation, tool calls, unknown model.
{
  const e401 = await ask(setup(() => ({ status: 401, body: JSON.stringify({ error: { message: `Invalid API key ${"sk-" + "x".repeat(26)}` } }) })).service).catch((e) => e);
  assert.match(e401.message, /API Key 无效/);
  assert.doesNotMatch(e401.message, /abcdefghijklmnop/);
  assert.equal(e401.outcome, "unknown");
  const e503 = await ask(setup(() => ({ status: 503, body: "<html>" })).service).catch((e) => e);
  assert.equal(e503.outcome, "unknown");
  assert.equal(await ask(setup(() => ok("half", "length")).service), "half\n\n（回复因长度上限被截断）");
  const parts = await ask(setup(() => ok([{ type: "text", text: "p1" }, { type: "text", text: "p2" }])).service);
  assert.equal(parts, "p1p2");
  const tool = await ask(setup(() => ({ status: 200, body: JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{}] }, finish_reason: "tool_calls" }] }) })).service).catch((e) => e);
  assert.equal(tool.code, "tool-call");
  const empty = await ask(setup(() => ok("")).service).catch((e) => e);
  assert.equal(empty.code, "empty-reply");
  const unknown = await ask(setup(() => ok("x")).service, "x", "claude-haiku-5-5").catch((e) => e);
  assert.equal(unknown.outcome, "not-dispatched");
  const bad = await ask(setup(() => ({ status: 200 })).service).catch((e) => e);
  assert.equal(bad.code, "bad-platform-response");
}

// 3. Platform errors pass through with their outcome.
{
  const err = Object.assign(new Error("请重新填写 API Key"), { code: "not-ready", outcome: "not-dispatched" });
  const got = await ask(setup(() => Promise.reject(err)).service).catch((e) => e);
  assert.equal(got, err);
}

// 4. One request at a time; cancelling a queued reply leaves at once.
{
  let active = 0;
  let max = 0;
  let releaseFirst;
  const t = setup(async (_p, _s, n) => {
    active += 1;
    max = Math.max(max, active);
    if (n === 1) await new Promise((r) => (releaseFirst = r));
    active -= 1;
    return ok(`r${n}`);
  });
  const first = ask(t.service, "1");
  const aborter = new AbortController();
  const second = t.service.reply({ model: "kimi-k3", history: [], input: "2" }, aborter.signal).catch((e) => e);
  const third = ask(t.service, "3");
  await new Promise((r) => setTimeout(r, 10));
  aborter.abort();
  assert.equal((await second).name, "AbortError");
  assert.equal(t.calls.length, 1);
  releaseFirst();
  assert.equal(await first, "r1");
  assert.equal(await third, "r2");
  assert.equal(max, 1);
}
console.log("all passed");
