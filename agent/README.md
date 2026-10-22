# Local agent

A general-purpose assistant that runs on your own model through llama-server or LM Studio. It chats, works with project files, and has standalone Windows IT tools for package deployment, machine inspection, service/process controls, AD lookup and remote support. Atlas does not need to be installed or running. File tools stay inside the working folder; IT tools use the explicitly configured package repository and selected Windows PCs. Changes ask for approval unless you start with `--yes`.

It needs Python 3.8 or newer and nothing else.

## Terminal interface

The console opens with the active model, context, thinking/approval mode, workspace and package repository. Responses stream below clearly labelled tool activity; inspections and deployment results use compact tables. During model/tool work an elapsed-time indicator runs in interactive terminals. Reasoning stays compact by default; add `--verbose` to show reasoning (with `--think`) and complete tool results.

The interface uses the standard library and keeps normal terminal scrollback. It adapts to narrow windows, falls back to ASCII when needed, honours `NO_COLOR`, and supports `--plain` for output without colour or animation. Model/file/command text cannot inject terminal control sequences. Approval panels show the complete wrapped action, with control characters made visible.

| Command | Action |
| --- | --- |
| `/help` | Show commands and keyboard hints |
| `/status` | View model/server, context, paths and session settings |
| `/jobs` / `/jobs ID` | Read deployment/reboot jobs directly, without asking the model |
| `/output` / `/output ID offset` | Read the latest or selected saved tool result in character pages |
| `/history` | Show recent requests from this session |
| `/paste` | Enter a multiline request; submit with a single `.` line |
| `/reset` | Clear model conversation; retain jobs and saved output |
| `/clear` | Redraw the terminal header |
| `/exit` | Close the chat; accepted background IT jobs continue |

Saved job/output IDs accept an unambiguous prefix of at least six characters. Ctrl+C cancels the current request and returns to the prompt; it does not terminate the model server or cancel accepted background jobs. Interrupted actions can have unknown outcomes, so inspect their state before retrying. Input during `/paste` is discarded if cancelled. Incomplete/truncated model tool calls are not executed.

Keep `terminal_ui.py` next to `agent.py`; setup and the Windows bundle include it.

## Standalone Windows IT actions

Keep `agent.py`, `it_tools.py`, `it_windows.ps1` and `terminal_ui.py` together. Both setup and the Windows bundle include them. To update an existing bundle, replace these files plus `start.py`; keep your models, notes and `state` folder.

Start normally; the pictured OneDrive package repository is already the default:

```bat
python start.py --model 35b
```

Default repository:

```text
C:\Users\x01426046\OneDrive - Barclays Bank PLC\Shortcuts\EPP_PACKAGE_REPO_BetaPackages - BetaPackages
```

`--package-repo`, `AGENT_PACKAGE_REPO`, or `WMI_PACKAGE_REPO` can override this path if needed. Keep the OneDrive shortcut synced and accessible to the account running the agent. Atlas's database is not needed. If the folder is unavailable, chat, machine inspection and other IT tools still work.

Example requests (replace `PC-123` with your intended target):

- “Find the available packages for ExampleApp and show its install and uninstall scripts.”
- “Check PC-123's WMI access, administrative share and free disk space.”
- “Copy the selected ExampleApp package to PC-123 without running it, then check the job.”
- “Install the selected package on PC-123 and PC-456 and report each result and log.”
- “Inspect the print spooler on PC-123, restart it, and verify that it is running.”
- “Show PC-123's processes and stop the selected process.”
- “Look up this exact AD account and show its groups.”
- “Open Remote Assistance for PC-123.”

The model gets these tools:

| Tool | What it does |
| --- | --- |
| `inspect_computer` | Preflight, OS/user/memory, disks, services, processes and machine-wide software registrations; paginated results. |
| `find_packages` | Search package folders and discover `.ps1`/`.vbs` scripts ending in `_i`/`_install`/`_installs`, `_u`/`_uninstall`/`_uninstalls`, or `_r`/`_repair`/`_repairs`. |
| `deploy_package` | Install, uninstall or repair through the selected package script; full, copy-only or execute-existing modes; up to 200 explicit PCs, processed in order. |
| `it_job_status` | Saved per-PC outcomes, exit codes and logs, with bounded waits; inspect unknown outcomes before releasing a target for another attempt. |
| `computer_action` | Verified service start/stop/restart, checked process termination, explicit RemoteRegistry enable/start, monitored reboot, and cleanup of this agent's package staging only. |
| `directory_lookup` | Exact AD user/computer/group lookup and membership; read-only. |
| `open_remote_tool` | RDP, Remote Assistance, Computer Management, Event Viewer, administrative share, temp or package folder. Opens the UI; does not automate a remote session. |
| `read_tool_output` | Read the full saved output when a result was too long for the conversation. |

Deployment uses your Windows identity, SMB administrative shares, Robocopy and WMI/DCOM; it does not use PsExec or require WinRM. Targets must permit WMI/file sharing and your account must have the needed rights. AD lookup needs RSAT's ActiveDirectory module. The backend never changes firewall policy or credentials to work around access errors.

Packages stage under `C:\Temp\LocalAgent\Packages` on each target; each attempt owns a unique log/exit record under `C:\Temp\LocalAgent\Jobs`. The approved installer checksum is rechecked before launch. Robocopy codes 0–7 mean successful copying; 8+ fail. A job ID means queued. `script_succeeded` means the script returned 0, **not** that the application is healthy; `reboot_required` reports script exit 3010/1641 and still requires checking the application/vendor log. Missing exit records or lost monitoring produce `unknown`, never success or an automatic retry.

Deployment/reboot workers run separately from the chat, so closing the chat does not cancel remote work. Job records and full tool output live in `state` next to the agent (override with `--state-dir`). If the worker/PC stops unexpectedly, inspect `it_job_status` and the target before retrying. Unknown jobs reserve their targets until you explicitly acknowledge inspection. No automatic reboot or remote installer cancellation is performed.

Service and process changes use recent snapshots bound to the selected PC; the backend re-reads identity before acting and checks the final state. Critical services/processes are protected. Software inventory reads machine-wide uninstall registry entries, not `Win32_Product`; user registrations and MSIX/Appx packages are not included. Uninstall/repair uses your repository's corresponding script, not guessed vendor switches. Existing `run_command` remains available for operations outside these named tools.

## Offline bundle (Windows, browser downloads only)

If the command line can't reach the internet, download [local-agent-windows.zip](https://github.com/AOSPAndroid/tools/releases/download/local-agent-windows/local-agent-windows.zip) and the parts of one model in your browser:

- [Qwen3.6-35B-A3B](https://github.com/AOSPAndroid/tools/releases/tag/qwen3.6-35b-a3b-q4-k-m): 22 GB, needs 32 GB of RAM or more. This is the recommended model. It's a mixture-of-experts model with about 3B parameters active per token, so it runs well on a processor.
- [Qwen3.8-9B distill](https://github.com/AOSPAndroid/tools/releases/tag/qwen3.8-9b-q4-k-m): 5.8 GB, needs 16 GB of RAM.

Then double-click `Start Agent.bat`. `start.py` checks and joins the parts, using about 2 GB of spare disk and resuming if interrupted. It then starts llama-server and opens the agent. If both models are present it uses the 35B. Add `--model 9b` to choose the smaller one.

## Quick setup (Windows)

`setup_local.py` downloads and verifies the model, installs the right llama.cpp build for your GPU, fetches the agent, and writes `start-server.bat` and `agent.bat` into `%USERPROFILE%\local-ai`:

```
curl.exe -LO https://raw.githubusercontent.com/AOSPAndroid/tools/claude/local-agent/agent/setup_local.py
python setup_local.py
```

You need about 12 GB of free disk space while it runs. Running it again resumes an interrupted download and skips steps that are already done. Options: `--dir D:\ai` installs somewhere else, and `--gpu vulkan` or `--gpu cpu` overrides the build it picks.

Then double-click `start-server.bat`, open a terminal in a project folder, and run `agent.bat`. The sections below cover a manual setup.

## 1. Start the model server

**llama.cpp:** put `start-server.bat` next to `Qwen3.8-9B-Q4_K_M.gguf` and run it. It amounts to:

```
llama-server -m Qwen3.8-9B-Q4_K_M.gguf -ngl 99 -c 16384 --jinja --host 127.0.0.1 --port 8080 --temp 0.6 --top-p 0.95 --top-k 20
```

`--jinja` is required: without it llama-server ignores tool definitions. The Windows tools need more context than plain chat, so the default is 16384 tokens. If memory is tight, use `--ctx 8192` on both server and agent. When using `start.py`, `--ctx` is passed to both automatically.

**LM Studio:** load the model, start the local server (Developer tab), and pass `--url http://127.0.0.1:1234/v1` to the agent.

## 2. Run the agent

```
python agent.py --workdir C:\path\to\project
```

Type a task at the `>` prompt. `/reset` clears the conversation and `/exit` quits. To run a single task and exit:

```
python agent.py --workdir C:\path\to\project "list the .ps1 files and say what each one does"
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--url` | `http://127.0.0.1:8080/v1` | Server address (`AGENT_URL` env var) |
| `--model` | `Qwen3.8-9B-Q4_K_M` | Model name sent to the server (`AGENT_MODEL`) |
| `--workdir` | current folder | The only folder the file tools may use |
| `--ctx` | `16384` | Must match the server's `-c`; older history is compacted to fit |
| `--yes` | off | Approve writes and commands without asking |
| `--think` | off | Turn on Qwen's thinking mode: better on hard tasks, slower, uses more context |
| `--package-repo` | OneDrive BetaPackages folder above; environment variables override | Root containing deployable package folders |
| `--state-dir` | `state` next to agent.py | Durable jobs, snapshots and full tool results |
| `--max-steps` | `30` | Maximum model/tool rounds per request (1–200) |
| `--deployment-timeout` | `3600` | Copy/installer monitoring timeout in seconds (60–86400) |
| `--plain` | off | Disable colours and animation |
| `--verbose` | off | Show full tool output and reasoning when thinking is enabled |

## Your notes

Put runbooks, procedures, known fixes and names as `.md` or `.txt` files in the `notes` folder next to `agent.py` (or pass `--notes DIR`). The agent sees the list of files, searches them with `search_notes` before guessing, and opens one with `read_note`. `notes/ALWAYS.md` is loaded into every conversation, so keep it short. `notes/EXAMPLE.md` shows the format.

`--think` turns on the model's reasoning and shows it, dimmed, before the answer. It's slower.

## Notes

- On Windows, commands run in Windows PowerShell. Read-only commands (`Get-*`, `Test-Connection`, filtering and formatting cmdlets, `ipconfig /all`, `whoami`, `quser`, `sc.exe query` and similar) run without asking: PowerShell's own parser checks each command first. Anything that changes something or runs a script still asks. Commands run with your user's permissions. The folder restriction applies to the file tools only. A command can reach anything you can, so read each one before you approve it, and save `--yes` for folders you don't mind losing.
- A 9B model works best on short, concrete tasks. Split large jobs into steps.
- Tool output shown to the model is capped at 3,000 characters; longer results are saved in full and can be read in pages. A request stops after 30 model/tool rounds by default; accepted background IT jobs continue.

## Verification

Run `python -m unittest discover -s agent/tests -v` from the repository root. Tests use temporary package repositories and simulated Windows responses; they never deploy, reboot or change a live PC. When Windows PowerShell or `pwsh` is installed, PowerShell tests also execute the backend against mock WMI objects, including stale identities, protected operations, failed return codes and missing final state. `AGENT_TEST_POWERSHELL` selects a specific executable.

Before broad use, run a copy-only job and a small test package against a Windows test PC using your actual account. Domain permissions, network policy and vendor installer behaviour require verification in your environment.
