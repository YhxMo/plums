# DeepSeek 协议扩展本地验证

日期：2026-10-17（Asia/Shanghai）。负责人：扩展维护者；独立审查者未参与实现。验收范围为真实服务的协议扩展通过公开 `text.transform@1` 复用现有 Agent 消费者，网络由隔离假平台代替。

## 源码与边界

基线提交 `9c05356de46409d199a35f4eeff2831a23c8bba9`；受验工作区差异保存在 `.cache/deepseek-connector-2026-10-17/source/`，含 HEAD、tracked.patch、未跟踪源码清单及原文件。该材料保留受验实现和测试，不将仅有提交号当作完整版本。

本增量新增 `extensions/connectors/deepseek.js`、`tests/deepseek-connector.test.ts`，并同步当前设计、计划、证据和作者文档。`scripts/check-project.mjs` 仅移除公开供应商名称的错误禁词匹配，其余凭据、私人路径、非公开引用和文档检查保留。未修改生产 PlatformAdapter、Rust/Android 实现、默认安装集合或 UI；没有系统秘密操作、账户使用、外部模型请求和交付包替换。

## 已执行验证

| 对象 | 命令或操作 | 结果与证据范围 |
| --- | --- | --- |
| 实现前失败 | `npm test -- tests/deepseek-connector.test.ts` | 缺少连接器模块导致失败，`before.log` 保留 |
| 全单元回归 | `npm test` | 37 文件、298 项通过，其中新连接器 24 项；最终日志 `unit-final-2.log` |
| 类型和 Web 构建 | `npm run build` | TypeScript 与 Vite 通过，`build.log`；dist/connectors/deepseek.js 随构建复制 |
| 规范检查 | `npx tsc --noEmit`、`npm run format:check`、`npm run check:project`、`git diff --check` | 最终测试修改后类型通过；格式、公开文档链接/隐私模式及空白检查通过；对应 types-final.log、format.log、project.log、whitespace.log |
| 独立审查 | 对连接器、测试、检查器调整及接入边界只读复核，核对最终测试报告和文档 | 未发现 P1/P2；确认连接器 owner、取消/迟到拒绝、错误脱敏、不重试和本地切回；核对本地结果未冒充生产或原生验收 |

日志位于 `.cache/deepseek-connector-2026-10-17/`，早期失败记录保留；原始日志和源码快照不提交。最后一次测试配置修正只让 fractional maxTokens 用例捕获 Host.start 的预期激活拒绝，不改变产品实现。

24 项测试覆盖：连接器自身 owner 的最小请求；当前文本单独发送且角色/历史留在本地；模型和输出预算配置；UTF-8 与 JSON 转义超限；不完整或无效响应；仅返回文本、不返回思考和元数据；401/429/500 脱敏；分发失败与 unknown；取消迟到结果与任务释放；缺少授权/平台能力时无服务；预取消零平台调用；小数预算拒绝；停用后旧服务不能发请求，切回本地保留已存消息。

## 尚未验证

本地测试使用 `.invalid` 目标和固定假凭据。它验证公开契约及业务接线，不能证明 JSON HTTP 头、真实 Bearer 注入、TLS/DNS、系统秘密、服务端命中计数或原生传输。没有浏览器或 Mac/Android 新包运行结果；本增量没有改变已交付 UI，先前 UI 证据仍只绑定原受验版本。

真实 API 输入输出、系统秘密操作、受限网络及共享消费者的来源说明，继续按[当前阶段](../docs/spec/milestone.md)推进。该阶段未退出；当前普通包与旧包归档入口沿用[交付索引](RESULTS.md)。
