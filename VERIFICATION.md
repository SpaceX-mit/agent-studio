# 验证记录

验证时间：2026-09-06

## 运行验证

- 使用 `python -m http.server 8765` 启动本地静态服务。
- 使用 Codex in-app browser 打开 `http://127.0.0.1:8765/index.html`。
- 页面 DOM 正常加载，无外部静态资源依赖。

## 交互验证

| 场景 | 结果 |
| --- | --- |
| 新对话输入并发送 | 通过：显示用户消息、分析中状态和助手回复 |
| `Ctrl/Cmd + Enter` | 通过：触发发送 |
| `Ctrl/Cmd + K` | 通过：打开最近会话搜索 |
| `Escape` | 通过：关闭搜索、菜单和模态框 |
| Pull Request → 查看变更 | 通过：打开本地 diff review 模态框 |
| 已安排 → 创建任务 | 通过：弹出任务表单并生成任务卡片 |
| 项目选择 | 通过：更新 Composer 项目名并保存 |
| 模型选择 | 通过：更新模型/推理强度并保存 |
| 添加附件 | 通过：显示附件标签并可移除 |
| 深色主题 | 通过：切换并在刷新后恢复 |
| 最近会话 | 通过：刷新后恢复已发送内容 |
| 设置页 | 通过：修改主题和默认项目 |
| 侧栏导航 | 通过：新对话、PR、已安排、插件页面可切换 |

## 自动检查结果

- 消息发送断言：通过
- PR diff 可见断言：通过
- 自动化任务弹窗断言：通过
- 项目、模型、附件状态断言：通过
- 浏览器 console error：`0`

## 工程化迁移骨架检查

- `desktop/package.json`：Electron + React + TypeScript + Vite 脚本与依赖声明已创建。
- `desktop/electron/main.cjs`、`preload.cjs`：窗口、最大化 IPC、context isolation 和 sandbox 配置已创建。
- `desktop/src/domain.ts`：Thread、Message、Project、Automation、DesktopState 类型已创建。
- `desktop/src/store.ts`：本地状态加载、保存、创建线程、追加消息接口已创建。
- `desktop/src/main.tsx`、`styles.css`：最小 React 工作区、导航、欢迎页、Composer 和消息流已创建。
- Node 语法检查：Electron 主进程和 preload 通过。
- Electron 开发入口已配置 `desktop:dev`：Vite + `electron . --dev`，主进程在开发模式加载 `http://127.0.0.1:5317`；端口可通过 `VITE_PORT` 覆盖。
- Electron 本体已下载并验证：`electron --version` 返回 `v44.2.0`，直接执行 `electron . --dev` 后检测到 `codex-desktop-replica` 窗口进程且 `Responding=True`。
- 若 5173 已被已有 Vite 进程占用，`desktop:dev` 的并发 Vite 子进程会提示端口冲突；关闭旧 Vite 进程后重新运行即可，或直接执行 `electron . --dev` 复用现有 5173 服务。
- 实机排障：VSCodium 内部 Node 服务占用了 5173/5174 且不返回页面，导致 Electron 空白窗口；切换到 5317 后 HTTP 返回 200，Electron 窗口 `Codex Desktop` 正常显示且进程 `Responding=True`。
- 当前环境没有项目级 TypeScript/React 依赖，因此未执行 `npm run build`；安装依赖后应先运行该命令，再运行 `npm run desktop:dev`。
- 已通过工作区 Node/pnpm 安装 `desktop` 依赖并执行 `pnpm run build`：TypeScript 与 Vite production build 均通过。
- 已启动 Vite 开发服务 `http://localhost:5173/`，浏览器可见 React/Vite 欢迎页、四个快捷卡片和 Composer。
- React 版本消息发送验证通过，浏览器 console error：`0`。
- React 版本导航、项目菜单、Composer、消息发送在全新页面验证通过；全新页面 console error：`0`。此前热更新页面出现的旧 HMR 日志不影响冷启动结果。

## 尚未验证/未接入

- Electron 原生窗口与系统菜单
- 真实模型流式响应
- 真实 GitHub/GitLab PR 和 diff
- 真实 heartbeat/cron 调度与通知
- 真实终端、浏览器、沙箱和文件上传权限
- 1280px 之外的截图像素级回归；CSS 已提供窄屏断点
