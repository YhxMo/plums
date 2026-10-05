# SDK v2 契约

SDK v2 扩展 SDK v1；原有普通扩展无需修改。清单仍使用 2.x，未知字段继续保留。

`payload.plumsDesktop.connections` 声明通用 HTTPS 连接，引用本组件的地址设置、`service / https / request` 权限及密钥设置。`selectorSetting` 和 `credentialProfiles` 可按已保存设置选择凭据头；宿主不识别选择值的业务含义。连接权限只来自公开 permissions，连接元信息不单独授予访问权。

`payload.plumsDesktop.engines` 声明包内 Node.js 引擎入口、平台及 `jsonrpc-jsonl-v1` 通信。每个引擎须有 `kind: engine`、`target: 引擎 id` 的公开权限。引擎运行授权来自用户的独立长期信任确认，不由导入或普通组件启用隐式取得。

SDK 提供只读 `context()`、`connection(id)`、验证已完成响应的 `failResponse(callId, reason)` 和 `engine.start/request/cancel/stop/status`。引擎业务与模型协议由外装组件提供。可信宿主保留连接、凭据、用户确认和生命周期管理职责。
