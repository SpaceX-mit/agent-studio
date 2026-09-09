# MiniMax Tool Bridge

## Scope and ownership

The desktop launches the project-built open-source Codex app-server. The adapter
translates its Responses requests into MiniMax Chat Completions requests. It
does not execute commands, interpret XML tool tags, or approve operations.
Codex owns tool dispatch, sandboxing, approvals, command execution and files.

## Findings from the checked-out source

- `codex-upstream/codex-rs/tools/src/tool_spec.rs`: tool types include functions,
  namespaces, freeform tools, client tool search and hosted web search.
- `codex-upstream/codex-rs/tools/src/responses_api.rs`: freeform tools carry a
  grammar; namespace members carry their own names and parameter schemas.
- `codex-upstream/codex-rs/protocol/src/models.rs`: function calls require a
  stable `call_id` and JSON-encoded argument string; custom calls use raw
  `input`. Outputs are associated through `call_id`.
- `codex-upstream/codex-rs/codex-api/src/sse/responses.rs`: completed output items
  become `ResponseEvent::OutputItemDone`, which makes tool dispatch possible.
- `codex-upstream/codex-rs/core/src/tools/spec_plan.rs`: a model's capabilities
  determine whether the native `apply_patch` tool is offered. A generic MiniMax
  model can still edit files using Codex's command tool.

The previous adapter omitted all tool definitions, dropped tool-call deltas,
and emitted completed responses with empty message contents. That supported
text display but could not run the agent's tool loop or retain complete replies.

## Wire mapping

| Responses input | MiniMax Chat Completions |
| --- | --- |
| `instructions` | First system message |
| Developer messages | System messages with original content |
| Function tool | `tools[].function`, original parameter schema |
| Namespaced tool | Stable flattened name with reverse mapping |
| Custom/freeform tool | Function with one required string parameter, `input` |
| `function_call` | Assistant `tool_calls`, preserving ID and arguments |
| `custom_tool_call` | Assistant tool call wrapping raw input as JSON |
| Call output | Tool message with matching `tool_call_id` |
| Client tool search | Function wrapper; discovered tools enter the next request |

MiniMax tool-call fragments are accumulated independently by call index. All
names, IDs and JSON arguments are validated before any executable output item
is emitted. Custom tool input is unwrapped before delivery to Codex. Tool-call
argument events currently carry assembled arguments at completion; they do not
expose partially generated executable calls. Text deltas remain live.

Final message contents and usage are retained in completion events. UTF-8 is
decoded across byte boundaries. SSE error payloads, malformed arguments, unknown
tools, token-limit termination and missing finish reasons produce
`response.failed`, never a synthetic successful completion. HTTP refusals are
forwarded without deleting system instructions or changing the request to retry.
Disconnecting the client aborts the upstream request; requests have a timeout.

## Verification

From `desktop`, with the project's Node runtime available:

```powershell
node --test tests/tool-bridge.test.cjs tests/shutdown.test.cjs tests/minimax-models.test.cjs tests/turn-failure.test.cjs
node tests/app-server-tools.cjs
node tests/app-server-tools.cjs --approval
node tests/app-server-tools.cjs --deny
node tests/app-server-tools.cjs --custom
```

The integration tests use the actual project-built `codex.exe`, an isolated
`CODEX_HOME` under `.project-cache/tool-bridge-*`, and a local simulated MiniMax
server. No production credentials or upstream model requests are used. The
tests run a real PowerShell command, write and verify a test file, feed the
results into subsequent model requests, and verify the final assistant delta.
Approval tests accept or decline only these fixed test operations. The custom
test uses a Codex-recognized model capability profile with the same local fake
provider so that native `apply_patch` is exposed; it does not claim MiniMax has
that model ID. Test artifacts remain in the D-drive project cache.

## Limits and deployment

- A live MiniMax test requires `MINIMAX_API_KEY` in the launching process. No
  credential was available to this development turn; local protocol and actual
  Codex execution tests do not establish live model reliability.
- OpenAI-hosted web search cannot execute through Chat Completions and remains
  disabled in the app-server launch arguments. Felix registers a project-local
  `felix_web_search` MCP server that exposes a structured `web_search` function
  backed by public Bing News and Google News RSS feeds. It has bounded query
  length, timeout, deduplication, and result count limits; provider/network
  failures are returned as tool errors. The MCP config is generated under
  `.project-cache/codex-home`, so the official Codex Desktop configuration is
  never changed.
- Textual XML that resembles a tool call is not executable. The upstream model
  must return structured `tool_calls`; the adapter never runs model prose.
- The current input mapping covers text. Direct image-message input is rejected
  explicitly; multimodal support is outside this change.
- A model's account access, safety refusals, and tool-selection quality are
  separate from transport correctness.
- Restart the project replica using `start-desktop.ps1` to load the adapter.
  It inherits or securely prompts for the key. Rust recompilation is unnecessary.
