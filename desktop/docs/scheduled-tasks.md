# Scheduled Tasks

The sidebar's scheduled page is backed by the Electron main process, not browser
local storage. It supports agent tasks and reminders, one-time/daily/weekday/weekly
schedules, search, status filters, editing, pause/resume, manual execution,
cancellation, deletion and persistent execution records.

## Execution Boundaries

- Felix must remain running. Closing the app stops scheduling and cancels active
  runs. This implementation does not install an OS service or wake a sleeping PC.
- On reopening, each overdue enabled task runs once. Missed recurring occurrences
  are not replayed as a backlog. The next occurrence follows the chosen timezone,
  including daylight saving time.
- Only one scheduled task runs at a time. Opening this project copy twice focuses
  the existing window instead of starting another scheduler. Chat runs are separate.
- An occurrence is recorded and advanced before execution. After a crash its record
  becomes interrupted; potentially side-effecting work is not automatically retried.
  A failed one-time scheduled occurrence is completed as a schedule, with a failed
  run record. Edit its time or use manual execution to retry.
- Pausing prevents future occurrences; stopping cancels an active run. Manually
  running a paused recurring task does not resume its schedule. Successfully running
  a one-time task manually consumes that occurrence.

## Agent And Permissions

Each agent execution starts a dedicated project-built open-source Codex app-server
and a local MiniMax compatibility adapter. It never falls back to a system CLI.
The selected model comes from the existing MiniMax API model catalog. Missing keys,
provider errors, interactive questions and approval requests produce failed records.
Agent runs time out after ten minutes and their dedicated child processes are stopped.

The default sandbox is read-only. Unattended workspace writes require explicit
selection and confirmation in the editor. Approval escalation is never automatic.
Do not grant write access to tasks that should only inspect files. Schedules execute
in this Felix checkout, not an arbitrary project chosen in the chat composer.
Reminders do not call an LLM. Suggested tasks inspect actual workspace data; they
do not claim built-in email/calendar integrations.

## Storage And Notifications

All paths below are relative to the project root on D:.

- `.project-cache/scheduled-tasks/tasks.json`: task definitions and up to 50 runs
  per task, with the last 200,000 output characters per run.
- `.project-cache/scheduled-tasks/runs/<run-id>`: isolated Codex configuration and
  temporary data for each agent run. This is separate from official Codex Desktop.
- Package, Python and Rust caches used by scheduled subprocesses are redirected
  into `.project-cache`. Arbitrary third-party tools may have their own settings.

Deleting a task removes its stored definition and run records, but does not remove
its per-run directories or revert files changed by its agent. Those directories are
retained for diagnosis. Credentials are supplied by environment, never task JSON.
Task prompts and outputs are plaintext local data. Corrupt task JSON is reported
without overwriting the original file.

Notifications respect each task's checkbox and Windows notification settings.
Regardless of notification delivery, results remain available in task details.

## Verification

From `desktop`, after installing project dependencies and building the frontend:

```powershell
node --test tests/task-scheduler.test.cjs tests/task-runner.test.cjs tests/shutdown.test.cjs
node tests/scheduled-ui.cjs
node tests/scheduled-electron.cjs
```

UI tests use Playwright and installed Edge. Set `PLAYWRIGHT_MODULE_PATH` when using
an existing Playwright installation outside the project's module search path.
The runner integration uses the real project-built Codex executable with a local
model-response fixture, not paid provider requests. The Electron integration copies
the application into an isolated project-local test profile; it never opens or
modifies the user's active desktop profile. Screenshots are in
`.project-cache/ui-checks/scheduled-*.png`.
