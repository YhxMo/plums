# plums

Plums 内核（Apache-2.0）。pnpm 单仓库，包含：

- `@plums/core`：TypeScript 内核库
- `plums`：命令行。只调用库的公开 API；当前运行后打印版本号

## 环境

Node.js 22 或更新的 LTS，以及 pnpm 10。

## 命令

```sh
pnpm install
pnpm build
pnpm test
pnpm exec plums
```

`pnpm test` 会先构建，再跑 Vitest。`plums` 打印 `@plums/core` 的版本号。

## 已知限制

- 更新一个包时，不检查别的包是否依赖它的旧版本（不检查反向依赖）。
- 卸载一个包时，不检查别的包是否依赖它。依赖它的包会在下次启用时返回 `DEPENDENCY_MISSING`。
- 内核不做 DNS 解析。真实的 `EgressSink` 必须在解析后拒绝回环、内网和链路本地地址。
- 通配符只数域名标签，`*.co.uk` 和 `*.github.io` 仍可通过；公共后缀由宿主限制，因为内核不维护一份会过期的公共后缀清单。
- 内核不跟随重定向。`EgressSink` 返回 `redirectTo` 时，内核原样交还给调用方；要继续，调用方用新地址再调一次 `runAction`。

## 宿主契约

- 宿主在每次写入（write）之前，必须先调用 `core.runAction`，通过后才能写。内核对 write 只检查和放行，不执行写入。
- write 权限的 `target` 内核不解释。宿主必须自行约束写入的范围，不能超出用户同意的范围。
- 宿主实现的 `confirm.ask` 按 [docs/confirm-copy.md](docs/confirm-copy.md) 展示确认框。
