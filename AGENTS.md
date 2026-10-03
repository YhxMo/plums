# AGENTS.md

plums 是 Plums 开源内核（Apache-2.0），使用 TypeScript、Node.js 22+、pnpm 10，包含 `@plums/core` 和 `plums` CLI。

## 入口与范围
- `packages/core/src/index.ts` 是公开 API 入口；内核负责包校验、安装状态、权限、设置、密钥引用、分享与 MCP 工具批准。
- `packages/cli/src/main.ts` 只调用 `@plums/core` 公开 API；当前使用 `MemorySecretStore` 和 `RecordingEgressSink`，没有真实联网或持久化密钥。
- 行为与宿主契约见 `README.md`、`docs/architecture.md`，确认文案见 `docs/confirm-copy.md`；`docs/roadmap.md` 中的 exec/fs、审计、隔离运行等属于后续规划。

## 命令与验证
- 安装：`pnpm install --frozen-lockfile`；构建：`pnpm build`；全量测试：`pnpm test`（包含构建）。
- 定向测试先运行 `pnpm build`，再运行 `pnpm exec vitest run <测试文件>`；CLI 和跨进程测试会加载 `dist`。版本命令：`pnpm exec plums version`。
- 测试使用 `FakeModelProvider`、`RecordingEgressSink`、`MemorySecretStore`、`ScriptedConfirm` 和自造夹具，全程不联网；依赖 POSIX FIFO 的用例在 Windows 跳过。
- 修复先用公开行为回归复现；并发修改覆盖同进程与跨进程，密钥修改覆盖删前/删后抛错和重启重试，数据库迁移验证安装、同意与启用状态保留。

## 必须保持的契约
1. `payload` 不透明，内核不解释角色内容、不运行第三方代码；权限只来自 manifest 的 `permissions`。同 format major 的未知字段必须往返保留，导出保留传入的 `formatVersion`。
2. 动作依次检查已安装/启用/声明、同意、外发目标、write/egress 确认；确认返回后重新授权并检查权限档位和外发目标。write 的实际执行与范围约束由宿主负责。
   外发只经 `EgressSink`，不自动跟随重定向；MCP 指纹包含名称、描述、inputSchema，工具消失后撤销批准，宿主须传完整工具列表。
3. 密钥值只存 `SecretStore`，包、设置和数据库只保存引用；历史引用与更新清单在同一事务内保留，脱敏、导出检查及卸载也覆盖已移除字段的引用。
   等待全部密钥删除完成；失败不暴露底层异常。更新已提交后清理失败返回 `SECRET_NOT_FOUND`、`reason: SECRET_CLEANUP_FAILED` 和当前版本；通过后续更高版本更新或重试卸载清理，相同版本不能再次更新。
4. ZIP 路径、大小限制、大小写碰撞与文件/目录冲突在包文件写入前检查，导入/导出共用路径检查。导入先写 staging、插入安装记录，成功后才发布目录；失败方只能清自己的 staging，发布失败撤销本次安装记录。
   导入队列仅在同一进程内按 dataDir+id 排队；跨进程靠数据库唯一键保护。重复 id 返回 `IMPORT_INVALID`、`reason: ALREADY_INSTALLED`，不得覆盖已有记录或删除成功方文件。
5. 残留 settings：有 schema 时在导入写文件或更新交换目录前校验，失败导入不留包文件、更新保留旧版；无 schema 时导入拒绝且不读文件，更新不读不删。`setSettings` 校验失败使用 `SETTINGS_INVALID`，密钥引用错误仍用 `SECRET_NOT_FOUND`。

## 修改边界
- 维护公开 API 与错误的 code/path/details 契约，`path` 使用 JSON Pointer；错误、日志和导出不得泄漏密钥值或被拒的设置值。公开的 `validatePackage`、`inspectPackage` 不作为内部重复删除。
- 合并或去重测试时保留双方独有的行为断言；代码组合完成后重新验证，历史提交的测试结果不能替代最终组合的结果。纯规则文档修改只需静态核对与格式检查。
- 不提交 `node_modules/`、`dist/`、`coverage/`、运行数据、真实角色卡或密钥；兼容实现只参考公开规范，不复制 AGPL/GPL 项目代码。
