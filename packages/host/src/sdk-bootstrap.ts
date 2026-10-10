import { createCommonPlatformSdk } from "@plumsjs/sdk/common-client";
export const bootstrap = String.raw`
(() => {
  const out = [], pending = new Map(), handlers = new Map(), failures=new WeakMap(), events=new Map(); let next = 0;
  const rpc = (method, args) => new Promise((resolve, reject) => {
    const id = ++next; pending.set(id, {resolve, reject}); out.push({type:'rpc', id, method, args});
  });
  // Snapshot resource JSON before the transport can coerce non-JSON values or the author mutates it.
  const resourceJson = value => {
    const seen=new Set();
    const visit=(v,depth)=>{
      if(depth>32)throw Error();
      if(v===null || typeof v==='boolean' || typeof v==='string')return v;
      if(typeof v==='number' && Number.isFinite(v))return v;
      if(typeof v!=='object' || !v || seen.has(v) || Object.getOwnPropertySymbols(v).length)throw Error();
      seen.add(v);const descriptors=Object.getOwnPropertyDescriptors(v);let copy;
      if(Array.isArray(v)){
        if(Object.keys(descriptors).length!==v.length+1)throw Error();copy=[];
        for(let i=0;i<v.length;i++){const d=descriptors[i];if(!d || !('value' in d) || !d.enumerable)throw Error();copy.push(visit(d.value,depth+1));}
      }else{
        const proto=Object.getPrototypeOf(v);if(proto!==Object.prototype && proto!==null)throw Error();copy=Object.create(null);
        for(const [key,d] of Object.entries(descriptors)){if(!('value' in d) || !d.enumerable)throw Error();copy[key]=visit(d.value,depth+1);}
      }
      seen.delete(v);return copy;
    };
    try{const copied=visit(value,0);if(JSON.stringify(copied).length>1024*1024)throw Error();return copied;}catch{throw Object.assign(Error('Resource values must be finite JSON.'),{code:'INVALID_REQUEST'});}
  };
  const sdk = Object.freeze({
    resources: Object.freeze({list:()=>rpc("resource.list",{}),read:(binding,key)=>rpc("resource.read",{binding,key}),write:(binding,key,expectedRevision,value)=>rpc("resource.write",{binding,key,expectedRevision,value:resourceJson(value)}),delete:(binding,key,expectedRevision)=>rpc("resource.delete",{binding,key,expectedRevision})}),
    protocols: Object.freeze({status: (requirementId) => rpc('protocol.status', {requirementId}), invoke: (requirementId, input) => rpc('protocol.invoke', {requirementId, input})}),
    context: () => rpc('context', {}), connection: (id) => rpc('connection', {id}),
    failResponse: (callId, reason) => rpc('failResponse', {callId, reason}),
    engine: Object.freeze({
      start: (engineId) => rpc('engine.start', {engineId}),
      request: (engineId, method, input, requestId) => rpc('engine.request', {engineId, method, input, requestId}),
      cancel: (engineId, requestId) => rpc('engine.cancel', {engineId, requestId}),
      stop: (engineId) => rpc('engine.stop', {engineId}),
      status: (engineId) => rpc('engine.status', {engineId})
    }),
    register(kind, name, fn) { if(typeof fn !== 'function') throw Error('Invalid handler'); handlers.set(kind+':'+name, fn); },
    invoke: (packageId, kind, name, input) => rpc('invoke', {packageId, kind, name, input}),
    capability: (permissionId, request, mcpTool) => rpc('capability', {permissionId, request, mcpTool}),
    character: (packageId) => rpc('character', {packageId}), characters: () => rpc('characters', {}), settings: () => rpc('settings', {}),
    emit: (topic, data) => rpc('emit', {topic, data}), mcpCheck: (tools) => rpc('mcpCheck', {tools})
    ,onEvent(topic,fn){if(typeof topic!=='string'||typeof fn!=='function')throw Error('Invalid listener');let listeners=events.get(topic);if(!listeners){listeners=new Set();events.set(topic,listeners);}listeners.add(fn);return()=>listeners.delete(fn);}
  });
  const common=(${createCommonPlatformSdk.toString()})((method,args)=>rpc('common.'+method,method==='invoke'?{...args,input:resourceJson(args.input)}:args),sdk.resources);
  Object.defineProperty(globalThis, 'plums', {value:Object.freeze({...sdk,common})});
  globalThis.__drain = () => out.splice(0);
  globalThis.__settle = (id, ok, value) => { const p=pending.get(id); if(p){pending.delete(id); if(ok)p.resolve(value);else{const error=Object.assign(Error(value?.message || 'Host request denied'),{code:value?.code,path:value?.path,details:value?.details});failures.set(error,value?.failureId);p.reject(error);}} };
  globalThis.__done = (id, ok, value) => out.push({type:'result', id, ok, value});
  globalThis.__event = (id, topic, event) => {Promise.all([...(events.get(topic)||[])].map(fn=>Promise.resolve().then(()=>fn(event)))).then(()=>__done(id,true,null),()=>__done(id,false,null));};
  globalThis.__invoke = (id, kind, name, input) => {
    const fn=handlers.get(kind+':'+name);
    Promise.resolve().then(()=>{if(!fn)throw Error('Handler not registered');return fn(input)}).then(v=>__done(id,true,v===undefined?null:v),error=>__done(id,false,{failureId:failures.get(error)}));
  };
})();`;
