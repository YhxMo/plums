# AGENTS.md

plums 是 Plums 开源内核（Apache-2.0），使用 TypeScript、Node.js 22+、pnpm 10，包含 `@plums/core` 和 `plums` CLI。

## 入口与范围
- `packages/core/src/index.ts` 是公开 API 入口；内核负责包校验、安装状态、权限、设置、密钥引用、分享与 MCP 工具批准。
- `packages/cli/src/main.ts` 只调用 `@plums/core` 公开 API；当前使用 `MemorySecretStore` 和 `RecordingEgressSink`，没有真实联网或持久化密钥。
- 行为与宿主契约见 `README.md`、`docs/architecture.md`、`docs/capabilities.md`，确认文案见 `docs/confirm-copy.md`。0.2.0 已交付 fs/exec/egress 能力总线、逐次确认、能力审计与记录式执行；路线图中的真实执行、隔离、策略和生命周期审计仍是规划。
- 新包默认格式为 2.0，读取 1.x/2.x；`Manifest`/`Permission` 为联合类型，先按清单格式分支，再处理 2.x 权限的 kind。2.x extension 使用 runCapability；旧动作/MCP 仅接受 1.x。

## 命令与验证
- 安装：`pnpm install --frozen-lockfile`；构建：`pnpm build`；全量测试：`pnpm test`（包含构建）。
- 定向测试先运行 `pnpm build`，再运行 `pnpm exec vitest run <测试文件>`；CLI 和跨进程测试会加载 `dist`。版本命令：`pnpm exec plums version`。
- 测试使用 `FakeModelProvider`、`RecordingEgressSink`、`RecordingFsSink`、`RecordingExecSink`、`MemorySecretStore`、`ScriptedConfirm` 和自造夹具，全程不联网、不由 Sink 写文件或启动命令；路径边界用本地元数据夹具，超时用虚拟计时器。依赖 POSIX FIFO 的用例在 Windows 跳过。
- 修复先用公开行为回归复现；并发修改覆盖同进程与跨进程，密钥修改覆盖删前/删后抛错和重启重试，数据库迁移验证安装、同意与启用状态保留。

## 必须保持的契约
1. `payload` 不透明，内核不解释角色内容、不运行第三方代码；权限只来自 manifest 的 `permissions`。同 format major 的未知字段必须往返保留，导出保留传入的 `formatVersion`。
2. 1.x 动作依次检查已安装/启用/声明、同意、外发目标、write/egress 确认；确认返回后重新授权并检查权限档位和外发目标。1.x write 的实际执行与范围约束由宿主负责。
   外发只经 `EgressSink`，不自动跟随重定向；MCP 指纹包含名称、描述、inputSchema，工具消失后撤销批准，宿主须传完整工具列表。
3. 密钥值只存 `SecretStore`，包、设置和数据库只保存引用；历史引用与更新清单在同一事务内保留，脱敏、导出检查及卸载也覆盖已移除字段的引用。
   等待全部密钥删除完成；失败不暴露底层异常。更新已提交后清理失败返回 `SECRET_NOT_FOUND`、`reason: SECRET_CLEANUP_FAILED` 和当前版本；通过后续更高版本更新或重试卸载清理，相同版本不能再次更新。
4. ZIP 路径、大小限制、大小写碰撞与文件/目录冲突在包文件写入前检查，导入/导出共用路径检查。导入先写 staging、插入安装记录，成功后才发布目录；失败方只能清自己的 staging，发布失败撤销本次安装记录。
   导入队列仅在同一进程内按 dataDir+id 排队；跨进程靠数据库唯一键保护。重复 id 返回 `IMPORT_INVALID`、`reason: ALREADY_INSTALLED`，不得覆盖已有记录或删除成功方文件。
5. 残留 settings：有 schema 时在导入写文件或更新交换目录前校验，失败导入不留包文件、更新保留旧版；无 schema 时导入拒绝且不读文件，更新不读不删。`setSettings` 校验失败使用 `SETTINGS_INVALID`，密钥引用错误仍用 `SECRET_NOT_FOUND`。
6. 2.x 权限 id 唯一；fs 操作按集合精确授权，write 不隐含 read；exec 按 cwdRoots 限定范围。跨格式更新、新操作、类别/目标变化和新增目录根须重新同意。旧动作与 MCP 入口拒绝 2.x，不从未知 level 字段推断授权。数据库格式为 4，迁移保持权限 JSON、MCP 和密钥引用；历史 1.x 夹具固定格式，不跟随新包默认常量。
7. runCapability 在等待前复制请求，按校验→安装/启用/声明→同意→范围→确认→复核→放行审计→复核→Sink→结果审计执行。read/list 不询问，write/exec/egress 每次确认，只有布尔 true 放行；缺失/异常/非布尔/超时拒绝，默认 120 秒只作用于新入口。绑定创建时复制固定，路径按真实目录边界检查；真实 FsSink 执行时防路径竞争，真实 ExecSink 隔离由宿主负责。
8. 能力/确认审计按 callId 关联，不含内容、请求体、参数、输出或物理路径，使用已知密钥脱敏。缺少审计或执行前失败不得调用 Sink；CAPABILITY_FAILED 保留 callId、phase、executionState，不附底层异常；unknown/completed 勿自动重试。确认或异步审计期间状态、权限、路径变化须阻止执行。

## 修改边界
- 维护公开 API 与错误的 code/path/details 契约，`path` 使用 JSON Pointer；错误、日志和导出不得泄漏密钥值或被拒的设置值。公开的 `validatePackage`、`inspectPackage` 不作为内部重复删除。
- 合并或去重测试时保留双方独有的行为断言；代码组合完成后重新验证，历史提交的测试结果不能替代最终组合的结果。纯规则文档修改只需静态核对与格式检查。
- 不提交 `node_modules/`、`dist/`、`coverage/`、运行数据、真实角色卡或密钥；兼容实现只参考公开规范，不复制 AGPL/GPL 项目代码。
