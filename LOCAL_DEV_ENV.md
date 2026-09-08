# 本地下载与依赖目录约定

后续下载的源码、依赖、临时文件和构建缓存统一放在当前项目目录：

- 源码：`codex-upstream/`
- npm cache：`.project-cache/npm/`
- pnpm store：`.project-cache/pnpm-store/`
- 临时文件：`.project-cache/tmp/`
- 下载文件：`.project-cache/downloads/`

PowerShell 会话中建议先执行：

```powershell
$projectRoot = 'D:\Workspace2026\my-agent-plantform'
$env:TEMP = "$projectRoot\.project-cache\tmp"
$env:TMP = "$projectRoot\.project-cache\tmp"
$env:NPM_CONFIG_CACHE = "$projectRoot\.project-cache\npm"
$env:PNPM_HOME = "$projectRoot\.project-cache\pnpm-home"
```

目标仓库：`org-14957082@github.com:openai/codex.git`。

当前 SSH 公钥认证仍未通过；本机检测到并实际提供的是 `C:\Users\duancheng\.ssh\id_rsa.pub`（指纹 `SHA256:f58LlU4IsmJ68cCGX5vERbi6G3JzfXA536H6niUT3z0`），但 GitHub 同时拒绝了 `org-14957082@github.com` 和标准 `git@github.com` 入口。需要确认该公钥已添加到拥有 `openai/codex` 访问权的 GitHub 用户或组织，并确认仓库地址格式。授权后再在本目录执行：

```powershell
$env:GIT_SSH_COMMAND = 'ssh -o StrictHostKeyChecking=accept-new'
git clone 'org-14957082@github.com:openai/codex.git' .\codex-upstream
```
