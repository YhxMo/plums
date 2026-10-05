# 可信本机引擎

普通扩展继续在独立 Node 子进程和 V8 isolate 中运行。可信引擎是用户单独信任后运行的普通本机程序，拥有当前操作系统用户的文件、子进程和网络权限。两者共享 Agent 组装与管理界面，但采用不同运行机制。

## 声明与启动

组件使用 SDK v2，并在 `permissions` 声明引擎权限。宿主不从 payload、名称、角色内容或导入行为推导执行授权。

```json
{
  "permissions": [
    {
      "id": "local-engine",
      "kind": "engine",
      "target": "local",
      "reason": "执行本机任务"
    }
  ],
  "payload": {
    "plumsDesktop": {
      "sdkVersion": "2",
      "engines": [
        {
          "id": "local",
          "title": "本机助手",
          "entry": "engine/main.mjs",
          "runtime": "node",
          "platforms": ["darwin-arm64"],
          "protocol": "jsonrpc-jsonl-v1"
        }
      ]
    }
  }
}
```

引擎与 engine 权限一一对应，不能保留指向未声明引擎的权限。首版仅支持包内 `.js`、`.mjs` 或 `.cjs` 入口，由宿主固定的 Node.js 程序及参数数组启动。组件前端无法指定可执行程序路径。支持平台必须包含当前 `platform-arch`。

导入、填写配置和启用组件不会自动启动引擎。首次启动由宿主独立安全窗口询问：

> “本机助手”需要读取和修改本机文件、运行程序及访问网络。
>
> 信任将保留，直到你撤销授权或删除这个 Agent。

按钮为「暂不启动」和「信任并启动」。默认拒绝，只有布尔 true 且授权成功持久化后才启动。关闭、取消、异常、超时或保存失败均拒绝；确认期间升级、删除或撤权不能恢复旧授权。

## 长期信任

信任记录位于当前 Agent 私有 SQLite 数据库中，绑定 Agent 实例、组件安装身份、引擎 id 和完整 engine 权限声明，包含授权时间。它与短期任务范围分开保存。

- 重启、停止、停用或普通版本升级保留授权，并停止旧进程。升级中的引擎入口、协议或代码更新不代表来源可信，也不单独触发重新信任。
- engine 权限声明变化、新增引擎、卸载重装或新 Agent 必须重新授权。撤销信任立即阻止新请求并停止引擎。
- 组件移除、卸载或 Agent 删除清除授权；组合导出不携带信任记录。

制品摘要用于检查安装完整性。启动比较安装内容与公共库中固定的制品，再运行独立的已验证文件快照。它不是发布者、签名、官方身份或可信来源判断。本轮没有发布者验证、来源审核或市场机制。

## SDK 和通信

业务扩展 SDK 与业务前端 `window.plums.engine` 提供相同的 `start(engineId)`、`request(engineId, method, input, requestId?)`、`cancel(engineId, requestId)`、`stop(engineId)`、`status(engineId)`。前端接口绑定当前组件，不能控制其他组件的引擎。前端可直接取消长任务，无须等待普通扩展串行运行器。

```js
await window.plums.engine.start("local");
const task = window.plums.engine.request("local", "run", input, "task-1");
// 独立按钮可同时调用：
await window.plums.engine.cancel("local", "task-1");
```

通信为 JSON-RPC 2.0 JSONL，一行一个 UTF-8 JSON 对象：

```json
{"jsonrpc":"2.0","id":"initialization-id","method":"initialize","params":{"protocol":"jsonrpc-jsonl-v1"}}
{"jsonrpc":"2.0","id":"initialization-id","result":{"protocol":"jsonrpc-jsonl-v1"}}
```

握手限时 30 秒；每条消息最多 1 MiB；每会话最多 32 个未完成请求、8 MiB 缓冲及待完成请求正文。业务请求不使用 isolate 的五秒执行预算。取消发送 `$/cancelRequest`；五秒内未完成则终止整个引擎，未确定任务返回 `CAPABILITY_FAILED`，`executionState: unknown`。崩溃和断连不自动重放任务。

引擎通知 `engine.event`，参数为 `{topic, data}`。宿主绑定组件身份后转发给该 Agent 的业务前端。事件和结果按宿主已知密钥脱敏；原始 stderr 不进入业务事件或审计。

引擎可发起受控回调：

- `host.invoke`：参数 `{packageId, kind, name, input}`，只允许当前组件声明依赖的当前 Agent 贡献。普通能力调用仍复核调用链权限、连接授权、任务范围与单次确认。不会传递管理接口或 SecretStore 值。
- `host.confirm`：参数 `{message}`，展示真实宿主安全窗口，返回布尔值。具体批准策略由引擎或外装扩展决定。

宿主不提供模型、coding、自动审查或完全访问业务策略。公共模型连接器可选；引擎可以自带协议、选择其他连接器或不使用模型。

## 生命周期和清理

管理页始终提供状态、启动、停止和撤销信任。关闭业务前端或渲染进程崩溃只停止普通扩展运行与短期范围，保留独立引擎供管理页接管；重新打开界面可查询并重新连接。停用、更新、组合、配置或目录绑定变化会停止相关运行。

macOS 上每个引擎由独立监管器创建进程组，后代默认继承此组。停止先 TERM，三秒后仍存在则 KILL。监管器在 broker 通信断开时执行相同清理，因此 broker 被强制杀死仍能清理该组。应用退出会触发 broker 的停止流程与审计，broker 等待清理后退出。`DesktopHost.close()` 返回 Promise，调用方应等待清理完成。

这是进程组监管，不是系统沙箱；获得普通本机权限的程序可以自行脱离进程组。Windows 首版仅支持直接进程终止，完整后代清理验收以 macOS 为准。

审计仅记录授权、撤销、启动、停止和崩溃的身份、时间及状态，不记录正文、代码、参数、密钥、物理路径或原始输出。审计失败阻止启动，清理和撤权仍优先执行。

## 自造示例

`examples/trusted-engine` 提供独立界面和 Node 引擎，默认逐次询问；完全访问及自动审查是该示例自身的测试模式。自动审查仅允许示例的 read/list/wait/connector 操作，其他操作拒绝。任务包括文件读写、列目录、固定 Node 子进程、网络、长等待及主动调用可选模型连接器。

`pnpm examples:build` 生成 `trusted-engine.zip` 和无公共模型依赖的 `trusted-engine-agent.zip`。需要演示连接器桥时，再从公共库加入 `model-connector.zip` 并填写其配置和授权。

完成桌面打包与示例构建后，`pnpm desktop:engine-smoke` 使用临时数据目录和自造文件、子进程、局域回环 HTTP 服务验证打包应用的信任窗口、长任务、取消、前端崩溃恢复及管理页停止/撤权。它与确认窗口测试、普通 `desktop:smoke` 顺序运行。
