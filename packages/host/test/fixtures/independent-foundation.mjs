// Internal independent implementation, not an external author certification.
// Imports only Node's public APIs; never uses the official runtime or bootstrap.
import vm from "node:vm";
import path from "node:path";
import readline from "node:readline";
let binding,
  prepared,
  context,
  currentCall,
  busy = false;
const send = (message) =>
  process.stdout.write(
    JSON.stringify({
      foundationVersion: "1.0",
      sessionId: binding,
      ...message,
    }) + "\n",
  );
const run = (source) => vm.runInContext(source, context, { timeout: 5000 });
const jsonValue = (value) => {
  const encoded = JSON.stringify(value);
  return encoded === undefined
    ? "undefined"
    : `JSON.parse(${JSON.stringify(encoded)})`;
};
const bootstrap = `(()=>{
const handlers=new Map(),pending=new Map(),out=[],errors=new WeakMap();let next=0;
const rpc=(method,args)=>new Promise((resolve,reject)=>{const callbackId=String(++next);pending.set(callbackId,{resolve,reject});out.push({type:'callback',callbackId,method,args});});
const sdk=Object.freeze({register(kind,name,fn){if(typeof fn!=='function')throw Error('handler');handlers.set(kind+':'+name,fn)},settings:()=>rpc('settings',{}),context:()=>rpc('context',{}),capability:(permissionId,request,mcpTool)=>rpc('capability',{permissionId,request,...(mcpTool?{mcpTool}:{})})});
Object.defineProperty(globalThis,'plums',{value:sdk});
globalThis.__drain=()=>out.splice(0);
globalThis.__settle=(id,ok,value)=>{const p=pending.get(id);if(!p)throw Error('reply');pending.delete(id);if(ok)p.resolve(value);else{const e=Error('Host denied');errors.set(e,value.failureId);p.reject(e)}};
globalThis.__invoke=(kind,name,input)=>{const fn=handlers.get(kind+':'+name);if(!fn)throw Error('handler');Promise.resolve(fn(input)).then(value=>out.push({type:'result',ok:true,value:value===undefined?null:value}),e=>out.push({type:'result',ok:false,value:{failureId:errors.get(e)}}));};
})()`;
async function activate() {
  context = vm.createContext(Object.create(null));
  run(bootstrap);
  const modules = new Map();
  const load = async (name) => {
    if (modules.has(name)) return modules.get(name);
    if (!Object.hasOwn(prepared.extension.files, name))
      throw Error("Missing module");
    const mod = new vm.SourceTextModule(prepared.extension.files[name], {
      context,
      identifier: name,
    });
    modules.set(name, mod);
    await mod.link(async (specifier, owner) => {
      if (!specifier.startsWith("./") && !specifier.startsWith("../"))
        throw Error("External module");
      const target = path.posix.normalize(
        path.posix.join(path.posix.dirname(owner.identifier), specifier),
      );
      if (target.startsWith("../") || target.startsWith("/"))
        throw Error("Outside module");
      return load(target);
    });
    return mod;
  };
  const main = await load(prepared.extension.entry);
  await main.evaluate({ timeout: 5000 });
  // The extension's activate function runs inside its own realm; no Node object crosses in.
  context.__entry = main.namespace;
  run(`globalThis.__activation=Promise.resolve(__entry.activate(plums));`);
  await context.__activation;
  send({ type: "activated" });
}
const poll = setInterval(() => {
  if (!context) return;
  try {
    for (const m of run("__drain()")) {
      if (!currentCall) {
        send({ type: "fatal" });
        return;
      }
      send({ ...m, callId: currentCall });
      if (m.type === "result") currentCall = undefined;
    }
  } catch {
    send({ type: "fatal" });
  }
}, 10);
readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  try {
    const m = JSON.parse(line);
    if (m.foundationVersion !== "1.0") throw Error("version");
    if (m.type === "prepare") {
      if (prepared) throw Error("duplicate");
      prepared = m;
      binding = m.sessionId;
      if (
        m.sdk.id !== "org.plums.sdk" ||
        m.sdk.version !== "2.0.0" ||
        m.features.some(
          (f) =>
            ![
              "sdk.register",
              "sdk.settings",
              "sdk.context",
              "sdk.capability",
            ].includes(f),
        )
      )
        throw Error("SDK");
      send({ type: "ready", sdk: m.sdk, features: m.features });
    } else if (m.sessionId !== binding) throw Error("session");
    else if (m.type === "activate") {
      if (busy || context) throw Error("duplicate");
      busy = true;
      await activate();
      busy = false;
    } else if (m.type === "invoke") {
      if (!context || busy || currentCall) throw Error("state");
      currentCall = m.callId;
      run(
        `__invoke(${JSON.stringify(m.kind)},${JSON.stringify(m.name)},${jsonValue(m.input)})`,
      );
    } else if (m.type === "reply") {
      if (m.callId !== currentCall) throw Error("call");
      run(
        `__settle(${JSON.stringify(m.callbackId)},${JSON.stringify(m.ok)},${jsonValue(m.value)})`,
      );
    } else if (m.type === "stop" || m.type === "cancel") {
      clearInterval(poll);
      process.exit(0);
    } else throw Error("unknown");
  } catch {
    send({ type: "fatal" });
  }
});
