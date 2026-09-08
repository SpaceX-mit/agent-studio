# Plugins and skills

The Extensions page uses the project-built Codex app-server. No catalog entries,
installation state, or skill enablement are stored in renderer localStorage.

## Sources and isolation

- `plugin/list` queries local marketplaces for the project working directory.
  Codex includes its API-compatible curated catalog for this authentication mode.
- `skills/list` returns installed system, user, repository and plugin skills.
- Public entries are from Codex curated marketplaces; other local marketplaces
  appear under Personal. Featured entries are shown only when returned by Codex.
- Recommendations are skills read from available, uninstalled local plugins.
  Installing a recommendation installs its owning plugin, with this dependency
  explicitly disclosed before installation. This is not an openai/skills browser.
- The replica uses `.project-cache/codex-home`, not the official desktop profile.
  Plugin caches, temporary downloads and npm cache stay under `.project-cache`.
- The obsolete official `openai-bundled` marketplace reference was removed only
  from the project's config. The official application and its profile are untouched.

## Operations

- `plugin/read`, `plugin/install`, `plugin/uninstall`: native metadata and install lifecycle.
- `config/batchWrite`: updates one quoted plugin ID's `enabled` setting, with
  `reloadUserConfig: true`. No replacement of the entire plugins configuration.
- `skills/config/write`: path-specific enablement, honoring `effectiveEnabled`.
- Lists refresh after mutations and `skills/changed` notifications.
- Installed skills can display their actual `SKILL.md` as inert text.
- Local artwork and skill files pass through a bounded, read-only IPC bridge.
  Real paths must remain inside this project, including after junction resolution.

An installed plugin is not necessarily runtime-ready. Third-party MCP services,
accounts, API keys and platform-specific binaries may need separate setup.
ChatGPT-only remote marketplaces and account-sharing APIs are not queried with a
MiniMax key. Unsupported/private plugins are not fabricated to match screenshots.

## Verification

- `node --test tests/extensions.test.cjs`: catalog mapping and file isolation.
- `node tests/app-server-extensions.cjs`: real project binary with an isolated
  test home; install, skill discovery, toggles, restart persistence and uninstall.
- `node tests/extensions-ui.cjs`: Edge/Playwright using real catalog and assets,
  with all browser mutations mocked; search, details, switches, error/retry,
  recommendations and screenshots at 1280, 960 and 600 pixels wide.

Tests store artifacts inside `.project-cache`. The UI test does not mutate the
user's installed plugins or skills and does not send any model requests.
