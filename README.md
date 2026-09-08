# Codex Desktop UI/UX 复刻原型

这是基于参考截图制作的零依赖桌面式 UI 原型。当前环境没有 Node/npm，因此使用原生 HTML、CSS 和 JavaScript，既可以双击 `index.html`，也可以通过静态 HTTP 服务运行。

## 运行

```powershell
cd D:\Workspace2026\my-agent-plantform
python -m http.server 8765
```

然后打开 `http://127.0.0.1:8765/index.html`。

## 已实现

- Codex Desktop 风格窗口栏、左侧导航、最近会话和中央欢迎页
- 新对话、用户/助手消息时间线、模拟分析状态
- 会话搜索、`Ctrl/Cmd + K`、`Enter`/`Ctrl/Cmd + Enter`、`Escape`
- 最近会话本地恢复、重命名、置顶、归档
- 项目选择与本地保存
- 模型/推理强度选择与本地保存
- 附件队列与移除
- 浅色/深色主题与本地保存
- Pull Request 页面与本地 diff review 模态框
- 已安排页面、创建任务、暂停/恢复演示状态
- 插件、设置、通知和侧栏折叠

## 重要边界

当前数据和行为是本地演示实现，不会连接远程模型、GitHub/GitLab、终端、浏览器或自动化调度服务。正式产品应按 [CODEX_DESKTOP_PLAN.md](./CODEX_DESKTOP_PLAN.md) 中的 `ThreadStore`、`ProjectStore` 和 `AutomationStore` 替换点接入后端。

## 验证

验证记录见 [VERIFICATION.md](./VERIFICATION.md)。
