# Local agent

A small agent that runs on your own model through llama-server or LM Studio. It can list folders, read and write files, and run shell commands. It only touches files inside its working folder, and it asks before every write and every command.

It needs Python 3.8 or newer and nothing else.

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

## Notes

- Commands run in your normal shell (`cmd` on Windows) with your user's permissions. The folder restriction applies to the file tools only. A command can reach anything you can, so read each one before you approve it, and save `--yes` for folders you don't mind losing.
- A 9B model works best on short, concrete tasks. Split large jobs into steps.
- Tool output sent back to the model is cut to 6,000 characters, and a task stops after 15 tool calls.
