# Spike: Codex 接入探测

- Date: 2026-09-10
- Platform: Windows 10.0.19045 (AMD64)
- Environment versions: Node v24.19.0, npm 12.0.2, git 2.55.0.windows.3, PowerShell 7.6.6, OS Microsoft Windows NT 10.0.19045.0 (Windows 10 Pro for Workstations)
- macOS: 未测
- Linux: 未测

## Commands

Repeatable detector (report-only, always exits 0):

```powershell
node tooling/spikes/codex/probe.mjs
node tooling/spikes/codex/probe.mjs --deep
```

Manual PATH / install-location probes used on this host:

```powershell
where.exe codex
where.exe Codex
Get-Command codex -ErrorAction SilentlyContinue
npm list -g --depth=0
npm view @openai/codex name version description bin --json
winget list --name ChatGPT
powershell.exe -NoProfile -Command "Get-AppxPackage *Codex* | Format-List Name,PackageFullName,Version,InstallLocation"
```

Once an executable is resolved, version/help (15s timeout; stdout must be read asynchronously or redirected to a file — a sync pipe+`WaitForExit` deadlocks on `--help`):

```powershell
$cli = "$env:LOCALAPPDATA\OpenAI\Codex\bin\fd4c151a749f3ab4\codex.exe"
& $cli --version
& $cli --help
& $cli exec --help
& $cli exec resume --help
& $cli login --help
& $cli login status
& $cli logout --help
& $cli queue --help
& $cli sandbox --help
& $cli app-server --help
& $cli app-server daemon --help
& $cli doctor --help
& $cli features list
```

Auth/status only. Not run (would send model work, mutate credentials, or start extra daemons): `codex exec <prompt>`, `codex login`, `codex logout`, `codex app`, `codex app-server daemon start`, `codex cloud`, `codex update`.

## Expected

Learn whether a Codex CLI/app exists on this Windows machine, how T15 should detect it, which version it reports, and which Host SPI operations are visible from `--help` / dry status commands: start, events/stream, input, approval, cancel, event resume/cursor, usage, auth, pause, sandbox.

If no executable: mark all runtime ops unsupported on this host, but still document the detection procedure.

Do not invent flags. Do not treat session `resume` as event-cursor resume. Do not run paid tasks.

## Actual

`codex` is **not on PATH**. `where.exe codex` / `where.exe Codex` exit 1 (`INFO: Could not find files for the given pattern(s).`). `Get-Command codex` returns nothing. npm global does not include `@openai/codex`. cargo / scoop / chocolatey / `.local\bin` copies were absent.

Codex **is installed** as the Microsoft Store ChatGPT / OpenAI Codex MSIX app, plus a user-local CLI copy:

| Item | Value |
|---|---|
| Store / winget | ChatGPT `9PLM9XGG6VKS` version `26.903.8094.0` (msstore) |
| Appx package (registered) | `OpenAI.Codex_26.903.8094.0_x64__2p2nqsd0c76g0` |
| Install location | `C:\Program Files\WindowsApps\OpenAI.Codex_26.903.8094.0_x64__2p2nqsd0c76g0` |
| Extra MSIX folder (not the registered package) | `OpenAI.Codex_26.903.9818.0_x64__2p2nqsd0c76g0` |
| Preferred CLI | `C:\Users\chen\AppData\Local\OpenAI\Codex\bin\fd4c151a749f3ab4\codex.exe` |
| Bundled MSIX CLI | `...\app\resources\codex.exe` (same size `295408944`, same `--version`) |
| Desktop binaries | `app\ChatGPT.exe`, `app\Codex.exe` |
| CLI version | `codex-cli 0.153.4` |
| npm registry `@openai/codex` (not installed globally) | `0.154.0`, bin `codex` → `bin/codex.js` |
| User state | `%USERPROFILE%\.codex` exists (`config.toml`, `auth.json`, `version.json`) |
| App logs dir | `%LOCALAPPDATA%\codex\Logs` (not a CLI) |

`--version` (both LocalAppData hashed copy and both MSIX `resources\codex.exe`):

```
codex-cli 0.153.4
```

`--help` first screen (excerpt; full text captured by the probe script):

```
Codex CLI

If no subcommand is specified, options will be forwarded to the interactive CLI.

Usage: codex [OPTIONS] [PROMPT]
       codex [OPTIONS] <COMMAND> [ARGS]

Commands:
  exec              Run Codex non-interactively [aliases: e]
  login             Manage login
  logout            Remove stored authentication credentials
  app-server        [experimental] Run the app server or related tooling
  doctor            Diagnose local Codex installation, config, auth, and runtime health
  sandbox           Run commands within a Codex-provided sandbox
  resume            Resume a previous interactive session ...
  queue             Queue a message for an existing session
  ...
```

Observed help flags relevant to the Host SPI (quoted from this binary, not guessed):

- Start (non-interactive): `codex exec` with optional `[PROMPT]` or stdin; `--json` “Print events to stdout as JSONL”; `--ephemeral`; `-C/--cd`; `--skip-git-repo-check`.
- Interactive default: no subcommand → TUI. With `TERM=dumb` and no TTY: `ERROR: TERM is set to "dumb". Refusing to start the interactive TUI...` (exit 1). Dummy interactive session without a terminal is not available.
- Approval: `-a/--ask-for-approval` values `on-request` | `never`; also `--approve-for-me`.
- Sandbox: `-s/--sandbox` values `read-only` | `workspace-write` | `danger-full-access`; `codex sandbox` “Run commands within a Codex-provided sandbox” using “Windows restricted token sandbox”.
- Input: `codex queue --thread <THREAD> --message <TEXT>`; `exec` can read prompt from stdin.
- Session resume (not event cursor): `codex resume`, `codex exec resume [SESSION_ID] [--last]`.
- Auth: `codex login` / `login status` / `logout`. `login --help` documents `--with-api-key`, `--with-access-token`, `--device-auth`.
- No `pause` command. `codex pause --help` prints the top-level help (falls through). The word `pause` does not appear in captured help texts.
- No `proto` command on 0.153.4. `codex proto --help` also falls through to top-level help.
- `app-server` is experimental (`--listen stdio://|unix://|ws://`). `app-server daemon` can start/stop a local daemon; this spike did not start it.

Auth boundary (no secrets printed):

```
codex login status
# stderr: Logged in using ChatGPT
# exit 0
```

`auth.json` exists; only the non-secret `auth_mode=chatgpt` was recorded. Token fields were not dumped.

Config keys (values only where non-secret): `sandbox_mode = "danger-full-access"`, `[windows] sandbox = "unelevated"`. A `CODEX_CLI_PATH` env entry inside MCP config pointed at the same hashed LocalAppData `codex.exe`.

`codex doctor --json --summary` (redacted): `codexVersion=0.153.4`, `overallStatus=fail`. Checks: `auth.credentials=ok`, `installation=ok`, `sandbox.helpers=ok`, `state.rollout_db_parity=warning`, `terminal.env=fail` (expected under `TERM=dumb` probe env). Human doctor also reported auth storage File / stored auth mode chatgpt / filesystem sandbox unrestricted / network enabled / approval OnRequest / desktop package version `26.903.8094.0`. Cached `~/.codex/version.json` still said `"latest_version":"0.144.5"` (stale vs live `0.153.4` and npm `0.154.0`).

Third-party copy **not used** for capability claims: AionUi bundled `codex-cli 0.144.6` at `%LOCALAPPDATA%\Programs\AionUi\resources\bundled-aioncore\...\codex.exe`. T15 must not auto-select it.

Sync `WaitForExit` + redirected stdout deadlocked `--help` until killed at 15s; async read / file redirect completed immediately (`stdoutChars=5729`, exit 0).

## Capability findings

| capability | status | evidence | notes |
|---|---|---|---|
| detect executable | enforceable | Probe found LocalAppData hashed CLI + MSIX `resources\codex.exe`; PATH/`where.exe` miss | Detection must search beyond PATH. Prefer configured `executable`, then PATH, then `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`, then WindowsApps `OpenAI.Codex_*\app\resources\codex.exe`. Ignore third-party bundles unless configured. |
| version | enforceable | `--version` → `codex-cli 0.153.4` (exit 0, &lt;15s) | Parse `^codex-cli\s+(\S+)`. FileVersionInfo on the exe is empty. Do not trust stale `~/.codex/version.json`. |
| start | observable | Help: `codex exec` non-interactive; default is interactive TUI | Live `exec` **not run** (would call ChatGPT backend). TUI refuses non-TTY (`TERM=dumb`). No dummy session without remote/TTY. |
| events/stream | observable | `codex exec --json`: “Print events to stdout as JSONL”; `exec resume` also has `--json` | JSONL schema, backpressure, and Host event mapping **untested**. Do not assume a `proto` JSON-RPC subcommand — it is not in 0.153.4 help. `app-server` exists but is experimental and was not started. |
| input | observable | `codex queue --thread --message`; `exec` prompt from argv/stdin | Live mid-run input **untested**. Queue targets an existing session UUID/name. |
| approval | observable | `-a on-request\|never`; `--approve-for-me`; doctor: approval OnRequest | Live approval round-trip **untested**. Host still owns policy; CLI flags are adapter-internal. |
| cancel | untested | No `cancel` subcommand in `--help` | Interactive/exec cancel would be Host process-tree kill (T06), not a proven Codex RPC. Do not advertise a CLI cancel API. |
| event resume/cursor | unsupported | Help `resume` / `exec resume` restore a **session by UUID/`--last`**, not an event cursor | No cursor/sequence flag observed. Map Host `event.resume` as adapter-unsupported unless a later live test proves JSONL replay. |
| usage reporting | observable (at rest) / untested (live exec JSONL) | No usage/cost subcommand in `--help`. Existing `~/.codex/sessions/**/*.jsonl` rollout records (type names and payload **keys only**, no prompt/secret content) include `token_usage_record` and `event_msg.payload.type=token_count`. Sample payload keys: `thread_id`, `turn_id`, `session_id`, `usage`, `turn_token_usage`, `thread_token_usage`. | Live `exec --json` mapping **untested**. Do not report 0 cost. Host budget must treat unknown monetary cost as unknown (D14). |
| auth boundary | observable | `login status` → `Logged in using ChatGPT`; `login`/`logout` help; `auth.json` present with `auth_mode=chatgpt` | Adapter must call `login status` (or equivalent) and treat missing login as invalid. Never persist/print tokens from `auth.json`. `--with-api-key` reads stdin. Do not run `logout` from Host unless the user asked. |
| pause | unsupported | No pause command; `codex pause --help` falls through; “pause” absent from help texts | Return standard unsupported error. Matches protocol: enable `lifecycle.pause` only if a future probe proves it. |
| sandbox | observable | `-s read-only\|workspace-write\|danger-full-access`; `codex sandbox` restricted-token helper; doctor: unrestricted fs + network enabled; config `danger-full-access` / windows `unelevated` | Not a strong OS sandbox. Host Policy must still deny high-risk paths/network. `--dangerously-bypass-approvals-and-sandbox` exists and must never be the default. |

## Limits

- macOS and Linux were not tested.
- No live `codex exec` / model turn: event JSONL schema, live usage fields, approval prompts, cancel of a running exec tree, and resume-after-kill are unverified. Persisted rollout files on this host do contain `token_usage_record` / `token_count` (keys only sampled); that is not a live exec fixture.
- `app-server` / `exec-server` transports were help-only; no stdio session was opened.
- `Get-AppxPackage` from PowerShell 7 fails (`Operation is not supported on this platform`); Windows PowerShell 5.1 via `powershell.exe` works. Probe uses `powershell.exe` and directory listing of `WindowsApps`.
- Registered MSIX is `26.903.8094.0`; a `26.903.9818.0` folder also exists (likely staged). Both CLIs reported `0.153.4`.
- npm global `@openai/codex` is not installed; registry latest is `0.154.0` vs local CLI `0.153.4`.
- Interactive TUI cannot be smoke-tested from this non-TTY probe.
- Strong sandbox / pause / event-cursor resume are not established on this host.

## Recommendations

### T15 (Codex Adapter)

1. **Detect** in this order: `RuntimeConfig.executable` → PATH `codex`/`codex.exe` → `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe` (verify `--version`) → `WindowsApps\OpenAI.Codex_*\app\resources\codex.exe` via Appx identity `OpenAI.Codex`. Never pick AionUi or other bundled copies unless the user configured that path.
2. **Version**: run `--version`, parse `codex-cli X.Y.Z`. Record adapter + CLI + desktop package versions on the Run snapshot.
3. **Auth**: `codex login status` (expect a logged-in line on stderr here). If not logged in, `validate` fails with an auth error; do not start. Credential Broker injects API key only when using `--with-api-key` stdin; ChatGPT-subscription auth stays in Codex’s own store. Never copy `auth.json` into Host events.
4. **Capability probe**: parse `--help` / `exec --help` at validate time. Do not hardcode `proto`, `pause`, or guessed flags. If a subcommand is missing, mark the Host capability unsupported.
5. **Start mapping (proposed, unproven live)**: `codex exec --json -C <workspace> --skip-git-repo-check` plus Host-chosen `-s`/`-a`. Translate JSONL into standard events under `raw.openai.codex`. Until a live fixture exists, keep Mock as the default executable path in tests.
6. **Declare unsupported**: `lifecycle.pause`, `event.resume` (cursor). Cancel = Host process-tree kill via T06, then map process exit to `runtime.cancelled`/`orphaned` after identity checks.
7. **Windows spawn**: read stdout/stderr asynchronously; 15s timeouts on detect; do not deadlock on help.

### T05 (Mock / Host)

- Mock must cover pause-unsupported and event-resume-unsupported so UI/API do not show those actions for Codex-shaped descriptors.
- Host should already accept “runtime present but capability false”.
- Do not block Mock PR on live Codex; gate live Codex on a later authorized exec fixture.

### T07 (Policy/credentials)

- Default sandbox is **not** restrictive on this machine (`danger-full-access` / unrestricted fs). Host Policy must set the intended `-s` and approval mode; never pass `--dangerously-bypass-approvals-and-sandbox` except inside an already-sandboxed test harness.
- Treat ChatGPT login as a user-owned secret store. Host holds `credentialRef` only for API-key mode.
- Redact `auth.json`, access/refresh tokens, and `login status` extras before any event/log persist.
- Desktop/MSIX + CLI share `~/.codex`; concurrent Desktop use vs Adapter exec is an isolation risk for T06/T07 (workspace cwd + process identity).

### 契约变更请求

无必须立刻改协议的项。`RuntimeConfig.executable` 已足够作为显式路径；Windows MSIX / LocalAppData 发现属于 T15 内部实现。

可选（非阻塞）说明给 T00/T02：不要在示例或 SPI 注释里把 `codex proto` 写成 V0.1 必选传输；本机 0.153.4 没有该子命令。`resume` 语义是会话恢复，不能映射为 `event.resume` cursor。`lifecycle.pause` 保持可选且默认关闭。
