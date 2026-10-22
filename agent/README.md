# Local agent

A small general-purpose assistant that runs on your own model through llama-server or LM Studio. It chats and answers like any assistant, and when a request needs it, it can list folders, read and write files, and run PowerShell commands for IT work. It only touches files inside its working folder, and it asks before every write and every command.

It needs Python 3.8 or newer and nothing else.

## Offline bundle (Windows, browser downloads only)

If the command line can't reach the internet, download [local-agent-windows.zip](https://github.com/AOSPAndroid/Axis/releases/download/local-agent-windows/local-agent-windows.zip) and the parts of one model in your browser:

- [Qwen3.6-35B-A3B](https://github.com/AOSPAndroid/Axis/releases/tag/qwen3.6-35b-a3b-q4-k-m): 22 GB, needs 32 GB of RAM or more. This is the recommended model. It's a mixture-of-experts model with about 3B parameters active per token, so it runs well on a processor.
- [Qwen3.8-9B distill](https://github.com/AOSPAndroid/Axis/releases/tag/qwen3.8-9b-q4-k-m): 5.8 GB, needs 16 GB of RAM.

Then double-click `Start Agent.bat`. `start.py` checks and joins the parts, using about 2 GB of spare disk and resuming if interrupted. It then starts llama-server and opens the agent. If both models are present it uses the 35B. Add `--model 9b` to choose the smaller one.

## Quick setup (Windows)

`setup_local.py` downloads and verifies the model, installs the right llama.cpp build for your GPU, fetches the agent, and writes `start-server.bat` and `agent.bat` into `%USERPROFILE%\local-ai`:

```
curl.exe -LO https://raw.githubusercontent.com/AOSPAndroid/Axis/claude/local-agent/agent/setup_local.py
python setup_local.py
```

You need about 12 GB of free disk space while it runs. Running it again resumes an interrupted download and skips steps that are already done. Options: `--dir D:\ai` installs somewhere else, and `--gpu vulkan` or `--gpu cpu` overrides the build it picks.

Then double-click `start-server.bat`, open a terminal in a project folder, and run `agent.bat`. The sections below cover a manual setup.

## 1. Start the model server

**llama.cpp:** put `start-server.bat` next to `Qwen3.8-9B-Q4_K_M.gguf` and run it. It amounts to:

```
llama-server -m Qwen3.8-9B-Q4_K_M.gguf -ngl 99 -c 8192 --jinja --host 127.0.0.1 --port 8080 --temp 0.6 --top-p 0.95 --top-k 20
```

`--jinja` is required: without it llama-server ignores tool definitions. An agent needs more context than plain chat, so this uses 8192 tokens. If that doesn't fit in 8 GB VRAM, run `set CTX=4096` first and pass `--ctx 4096` to the agent.

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
| `--ctx` | `8192` | Must match the server's `-c`; older history is dropped to fit |
| `--yes` | off | Approve writes and commands without asking |
| `--think` | off | Turn on Qwen's thinking mode: better on hard tasks, slower, uses more context |

## Your notes

Put runbooks, procedures, known fixes and names as `.md` or `.txt` files in the `notes` folder next to `agent.py` (or pass `--notes DIR`). The agent sees the list of files, searches them with `search_notes` before guessing, and opens one with `read_note`. `notes/ALWAYS.md` is loaded into every conversation, so keep it short. `notes/EXAMPLE.md` shows the format.

`--think` turns on the model's reasoning and shows it, dimmed, before the answer. It's slower.

## Notes

- On Windows, commands run in Windows PowerShell. Read-only commands (`Get-*`, `Test-Connection`, filtering and formatting cmdlets, `ipconfig /all`, `whoami`, `quser`, `sc.exe query` and similar) run without asking: PowerShell's own parser checks each command first. Anything that changes something or runs a script still asks. Commands run with your user's permissions. The folder restriction applies to the file tools only. A command can reach anything you can, so read each one before you approve it, and save `--yes` for folders you don't mind losing.
- A 9B model works best on short, concrete tasks. Split large jobs into steps.
- Tool output sent back to the model is cut to 3,000 characters, keeping the start and the end, and a task stops after 15 tool calls.
