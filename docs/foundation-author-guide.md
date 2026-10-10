# 独立底座作者接入指南

本指南供独立实现底座的作者与可信宿主集成者使用。阶段 3 已把公共库中的第三方提供者接入 `FoundationRegistry`、`createFoundationSession` 和 `DesktopHost` 的真实 SDK 能力桥。第三方实现自己加载组件、注册贡献并实现其声明的 SDK，不需要导入官方 Runtime、worker 或 SDK bootstrap。

当前独立执行证据只覆盖官方 SDK 2.0.0 的 `register`、`settings`、`context` 和 `capability`（原生 fs/list）。完整 SDK、专门消费者验证扩展、可分发替代底座验收 ZIP、Agent 验证整合包和黑盒符合性工具仍延期。提供者声明的兼容结果始终是 `declared`，不能当作认证。

## 制作提供者 ZIP

使用公开 2.x extension 包。提供者的业务权限必须为空，与 `plumsDesktop` 声明互斥。`id` 必须等于提供者声明的 id。入口及它的静态依赖都在 ZIP 内，沿用包的路径、大小、碰撞检查。`entry` 不能是本机路径、远程 URL 或官方内置适配标记。

```json
{
  "formatVersion": "2.0",
  "kind": "extension",
  "id": "org.example.independent",
  "name": "Independent Foundation",
  "version": "1.0.0",
  "description": "Independent SDK subset implementation",
  "dependencies": [],
  "permissions": [],
  "payload": {
    "plumsFoundation": {
      "declarationVersion": "1.0",
      "id": "org.example.independent",
      "foundationVersion": "1.0",
      "entry": "provider.mjs",
      "execution": "controlled-node",
      "platforms": ["darwin-arm64"],
      "features": ["session.invoke", "session.callback", "session.cancel"],
      "hostFeatures": [],
      "sdks": [
        {
          "id": "org.plums.sdk",
          "range": "2.0.0",
          "features": [
            "sdk.register",
            "sdk.settings",
            "sdk.context",
            "sdk.capability"
          ]
        }
      ]
    }
  }
}
```

归档包含 `manifest.json`、`provider.mjs` 及包内依赖。未知同 major 附加字段往返保留，不形成权限。声明版本、接入协议、SDK 版本、包格式和制品版本相互独立；在线当前准确使用 `foundationVersion: "1.0"`。公开结构见 [JSON schemas](schemas/foundation-provider-1.json)，完整消息规格见 [底座契约](foundation-contract.md)。

## 导入与注册

以下代码运行在可信宿主，不能放到业务组件或包前端。`host` 是已初始化的 DesktopHost，`providerZip` 是待导入 ZIP 字节，`fixedNode` 是宿主选定的 Node 26.5.1。

```ts
import {
  FoundationRegistry,
  registerLibraryFoundation,
  createFoundationSession,
  type HostFoundationSession,
} from "@plumsjs/host";

const preview = (await host.preview(providerZip)) as { token: string };
const item = await host.importLibrary(preview.token);
const available = await host.listFoundations();
const chosen = available.find((p) => p.selection.digest === item.digest)!;
const registry = new FoundationRegistry();
const reference = await registerLibraryFoundation(
  registry,
  host.library,
  chosen.selection,
  { nodePath: fixedNode },
);
```

导入和发现只检查 ZIP、提供者声明及入口存在；不执行入口、不安装到 Agent、不启动会话、不询问业务权限。库按精确 ZIP 的 SHA256 保存制品；库注册与每次工厂创建都重新核对归档。库注册固定 id、具体版本和摘要；同 id/版本的不同摘要可共存。公共库第三方引用必须带 digest，缺失摘要、缺失制品或不兼容需求均拒绝，不回退官方。`registry.list()` 返回已注册引用和声明副本；`host.listFoundations()` 只发现公共库中的第三方制品，官方内置适配由官方注册入口提供。

`FoundationRegistry.register` 是更底层的可信宿主适配接口，允许可信应用注册自己的内存适配函数。该接口本身不等于库制品接入或 ZIP 验证，也不提供第三方代码沙箱。第三方包必须使用上述 `registerLibraryFoundation` 路径，不能把包提供的函数传给可信注册接口。

`registerLibraryFoundation` 的可选握手/调用预算由可信宿主设定，作者不能扩大。默认握手与激活各 10 秒，单次调用总期限 120 秒，上限 120 秒。`FoundationRegistry` 的平台与 hostFeatures 必须与实际宿主功能相符；不因声明而获得这些功能。

## 可信身份与真实能力桥

```ts
let session: HostFoundationSession | undefined;
try {
  session = await createFoundationSession(registry, reference, {
    component: verifiedInstalledContents,
    actor: {
      agentId,
      installationId,
      componentId: verifiedInstalledContents.manifest.id,
      componentVersion: verifiedInstalledContents.manifest.version,
      componentDigest: pinnedConsumerZipDigest,
    },
    bridge: dispatchAuthorizedSdk,
    assertActive: verifyCurrentInstallationAsync,
    assertCurrent: verifyCurrentInstallationSync,
  });
  await session.ready();
  // 可信宿主决定激活时点；准备和就绪阶段没有业务桥。
  await session.activate();
  const result = await session.invoke(
    "commands",
    "check",
    { value: 7 },
    {
      callers: [],
      ancestry: [componentId],
      signal: ownerController.signal,
      assertActive: verifyCurrentCallEdge,
    },
  );
} finally {
  try {
    await session?.close();
  } finally {
    await registry.settleCleanup(agentId);
  }
}
```

此处变量必须来自真实安装、制品记录和宿主已有授权闭包。提供者不能自报 actor、callers、ancestry、任务范围、执行状态或前端身份。公共工厂生成新 instanceId，适配器使用同一个身份。业务 input 内的同名字段仅是业务数据；消息顶层与 callback args 的保留身份字段被拒绝。

会话成功返回前失败时，工厂负责停止和清理；清理失败的 Promise 由注册表按 Agent 保留。`settleCleanup(agentId)` 只等待并报告这些工厂责任，它不重新发起清理、不重试业务，也不能替代已返回会话的 `close()`。会话成功返回后，可信调用方必须保留对象并 `finally await close()`，包括 ready/activate 失败。close 拒绝时仍是调用方的清理失败，不能记录为成功退出。直接 archive 原型入口没有注册表所有者，不使用 `settleCleanup`；其返回前失败由启动入口清理，返回后仍由调用方负责 close。

`bridge` 必须进入当前组件的既有 SDK/core 授权路径，检查调用链权限交集、同意、目录与目标范围、任务/单次确认、策略、MCP 批准、凭据注入、审计和执行前复核。bridge 的 signal 失效后不能新执行 I/O；异步等待后仍须复核。context 上的可选调用链断言补充实例断言，拒绝一条调用不应把原 SDK 错误改成提供者自报错误。

`HostOptions.foundation` 现在只决定新 Agent 和无绑定旧记录的默认选择，构造时复制。已有 Agent 的持久绑定优先，改变默认不会切换旧 Agent。创建、组合变更、启用和运行前检查 Agent 与全部可运行组件的要求。便携 ZIP 导入缺失或不兼容选择时保留数据和停用绑定，等待明确修复；不授予权限。显式 Agent 声明缺少 selection 时拒绝自动运行。

可信管理调用 `foundationPlan`、`switchFoundation`、`foundationStatus` 和 `setFoundationEnabled`。底座不能调用这些方法。持久固定、引用保护、事务/故障恢复、并发和数据格式要求见 [Agent 选择与切换](foundation-agent-selection.md)。官方离线制品、受信任旧版本执行和可信桌面入口见 [桌面管理与制品](foundation-desktop.md)。第三方不能通过自称 builtin-adapter 获得可信代码加载。作者自己的第三方接入仍使用前面的精确 library ZIP 路径。

## 实现 JSONL 会话

stdin/stdout 每行一个 UTF-8 JSON 对象。stdout 只能输出协议帧；stderr 不作为业务结果。每帧都含准确协议版本、宿主签发 sessionId 和 type。

1. 接收 prepare，保存宿主固定 binding、provider selection、SDK、协商 features、组件源码与贡献声明、limits。
2. 校验准备材料，回复 ready 的相同 SDK 和 features。尚未激活时不执行业务入口或回调。
3. 接收 activate，自行加载组件入口并运行 `activate(plums)` 注册 handler，完成后回复 activated。加载和注册仍不得请求宿主 API。
4. 接收 invoke，检查声明的 kind/name，调用 handler；SDK Promise 通过 callback 请求当前 callId 下的宿主方法。
5. 接收 reply，完成对应 callbackId 的 Promise；业务终态发 result。尚有宿主回调时不得提前发送终态。
6. cancel/stop 或断连时结束会话。宿主主动终止进程，作者确认不能拖延清理。

完整 prepare、ready、activate、invoke、callback、reply、result 示例及方法映射见 [公开消息规格](foundation-contract.md#完整的一次-jsonl-往返)。prepare 的源码 files 为 UTF-8 字符串，单帧最大 1 MiB；此传输尚未验收大制品或二进制 SDK 结果。当前最小组件需要显式声明上述 SDK features；未协商的方法拒绝。

独立作者自行实现 SDK Promise、注册与模块加载。可阅读仓库内部 `packages/host/test/fixtures/independent-foundation.mjs` 理解已执行的四方法子集；它是自造测试夹具，不是可分发完整底座模板。`register` 无宿主回调；`settings`/`context` 参数为 `{}`；`capability` 参数为 `{permissionId,request,mcpTool?}`。fs/list 请求与结果见公开契约。

宿主拒绝回调时，reply 只给 `HOST_DENIED` 和 `failureId`。SDK Promise 构造组件 realm 内的 Error 并关联该 failureId；如果错误传播到终态，result 的 `ok:false`、`value:{failureId}` 让宿主还原真实 SDK 错误。作者自己的失败使用 `ok:false`、`value:null`。不得伪造 code、phase 或 executionState。

## 执行监督与验收范围

首轮支持 macOS arm64。固定 Node 只运行包内已验证入口的只读快照；不运行官方 worker。每组件各有提供者进程与宿主端点，环境不继承密钥。OS 沙箱拒绝业务目录读写、网络、进程派生和任意 exec。扩展源码经 JSONL 提供，提供者不能从本机安装目录自行读取。

提供者声明不会授予业务权限；prepare、ready 和注册没有可执行的 SDK 回调上下文。宿主限制帧、回调并发/总数、stdin、CPU 和内存。Node old-space 64 MiB、RSS 上限 256 MiB；CPU 窗口约 5 秒，有采样余量，等待宿主不消耗 CPU。普通权限 engine 不等于受控底座，当前独立 JSONL 载体拒绝含 engine 声明的组件。

停止后同一会话不能复活。取消、超时、崩溃、协议破坏和撤权立即停止当前组件会话；close 等待监督进程退出及快照清理。清理失败返回固定错误并保留清理责任。已派发且无法确认结果的贡献为 unknown，真实终态为 completed，未派发为 not_started；不得自动重放 unknown/completed，不切回官方来重试副作用。

当前内部回归证明：公共库离线发现、固定摘要注册、同版本不同制品、真实 DesktopHost 的两个 Agent、宿主身份、准备零业务回调、原生文件 list 的确认与审计、直接 I/O 拒绝、确认期间撤权、崩溃/超时/取消及清理。未知 SDK 行为、所有消息槽、实际外部作者实现、可分发制品和完整黑盒符合性仍需后续验收，不能从本指南推导已通过。
