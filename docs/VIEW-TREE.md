# 实验固定视图树契约

可选 SDK `mountViewTree(root,node)` 返回 `{ready,close}`。节点为 `{id,mount(root,scope)}`；mount 可异步，scope 提供 signal、onDispose(fn) 与 mount(child,descendantRoot)。扩展可经普通版本服务传递节点，不需要 Host 理解具体 UI。仅固定树，不能在 mount 完成后保存 scope 再动态挂载。

ready 等待所有已启动子挂载，包括未 await 的子调用。当前路径重复 ID 拒绝；兄弟允许相同 ID。一个 HTMLElement 同时只能被一棵树中的一个节点占用，子根必须是父根的严格后代。冲突拒绝，不偷偷替换已有贡献。DOM 边界仅约束此公开方法；共享 WebView 不能限制恶意代码直接改 DOM。

作者在创建监听、DOM 或其他效果前调用 onDispose；清理按实际注册逆序执行。mount 失败触发取消，等待在途挂载结束后尝试全部清理，再拒绝 ready。在途 mount 收到取消后可以登记迟到清理，mount 返回后禁止新增注册。close 同步封闭挂载入口、发送取消，等待挂载结束并清理；重复 close 返回同一次清理结果。不合作的永不完成 mount 不可强制终止，承载 Host 的清理超时仍要求重启。

清理成功释放根占用；清理失败保留占用和拒绝结果，重复 close 不重试。异步根适配器必须捕获 ready，并显示真实失败回退；Host 原 View.mount 只同步返回 disposer，不能把此适配器的回退称为 Host 自动排除失败代际。close 的失败由承载树的视图扩展归属，暂不提供跨作者精确节点审计。

最小适配方式：ctx.view 注册的 mount 同步创建树；ready.catch 在本次挂载仍存活时显示失败说明和恢复入口；返回函数先标记已关闭，再 return tree.close()。管理入口由测试外壳独立保留，不靠失败子视图维持。依赖 provider 的停止由既有 Host requires/provide 传播到容器，使整个树释放。

作者样板通过公共服务 ui.panel@1 提供一个 node，以及读清理计数的诊断方法；另一个独立作者消费该服务，贡献非聊天任务板容器。实际方法是隔离上下文的内部独立执行者只读本契约与 SDK 编写样板，不代表真实社区反馈或完整未知需求 A2。

限定实现与两端专项结果见 [验收证据](../evidence/UI-COMPOSITION-2026-10-16.md)。历史测试组合未加入默认目录；普通应用的文本处理工作台已通过 [页面路由](PAGES.md) 使用固定树，并有 [独立页面嵌套](LOCAL-PROOF.md) 的浏览器验收。动态整页替换由路由层负责，固定树语义不变；最终普通原生包、真实触控与完整辅助技术继续待验。
