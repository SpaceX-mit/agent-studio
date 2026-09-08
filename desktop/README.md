# Electron + React + TypeScript 迁移骨架

这里是正式桌面工程的目标结构：Electron 负责窗口和本地能力，React 负责 Codex Desktop 的多页面 UI，TypeScript 负责线程、项目和自动化状态模型，Vite 负责开发和构建。

开发模式默认使用 `http://127.0.0.1:5317`，也可以用 `VITE_PORT=xxxx` 覆盖。

当前仓库根目录的 `index.html` 仍是可直接运行的零依赖验证原型；`desktop/` 是后续真实工程化迁移的隔离骨架，避免在依赖不可用时破坏已经验证的原型。

## 真实 Codex app-server

Electron 主进程会启动 `codex app-server --stdio`，并将 `CODEX_HOME` 默认放在
`../.project-cache/codex-home`。查找顺序是项目内 binary、Windows Codex 安装、PATH；
也可以通过 `CODEX_APP_SERVER_COMMAND` 指定其它 executable。渲染器完成
`initialize`/`initialized` 握手，支持 thread、turn、流式 `item/agentMessage/delta`
以及 `turn/interrupt`。没有可用 binary 或登录时，界面会显示连接状态，不会出现空白窗口。

## MiniMax 中国服务

项目包含一个本地兼容适配层，将 Codex 的 `/v1/responses` 请求转换为 MiniMax
`/v1/chat/completions` 并转发流式结果。密钥只从当前进程的 `MINIMAX_API_KEY`
读取，不写入仓库或配置文件。

```powershell
$env:MINIMAX_API_KEY = '<your MiniMax key>'
pnpm run desktop
```

建议迁移顺序：

1. 将根原型的 CSS tokens 和布局组件拆为 React components。
2. 用 `src/domain.ts` 的类型替代页面内的隐式对象。
3. 用 `src/store.ts` 的接口替换根原型的多组 localStorage key。
4. 接入 Electron preload 的线程、项目、文件和窗口 IPC。
5. 再接入真实线程、Git provider 和 automation connector。
