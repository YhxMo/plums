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
