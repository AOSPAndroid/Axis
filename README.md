# Axis

**A local AI assistant for IT support on Windows.** Axis runs an open model on your own PC with llama.cpp, so nothing you type is sent to an online AI service. It chats and answers questions like any assistant, and it can check and fix PCs on your network with PowerShell. Anything that only reads runs straight away; anything that changes something asks you first.

It works alongside **Atlas**: Atlas remains the tool for deployments and the directory, and Axis handles the questions, checks and quick fixes around them.

![Axis fixing a stopped Print Spooler: it checks first, asks before the change, then verifies](docs/images/03-approval.png)

## Quick start

1. Download **[local-agent-windows.zip](https://github.com/AOSPAndroid/Axis/releases/download/local-agent-windows/local-agent-windows.zip)** and all 12 `.part` files of **[Qwen3.6-35B-A3B](https://github.com/AOSPAndroid/Axis/releases/tag/qwen3.6-35b-a3b-q4-k-m)** into your Downloads folder.
2. Extract the zip, open the `local-agent` folder and double-click **`Start Agent.bat`**.
3. Wait for `Axis is ready`, then type a request, for example `is PC-FIN-042 online?`

The first start joins and checks the model parts, which takes a minute or two. Read the **[full guide](docs/GUIDE.md)** for models, options, notes and troubleshooting.

## What it looks like

| Checking a PC | Using your notes |
| --- | --- |
| ![Axis checking a PC's uptime and disks without asking](docs/images/02-check.png) | ![Axis answering from the notes folder](docs/images/04-notes.png) |

The screenshots show the real Axis interface. The PC names, people and values in them are sample data.

## What Axis does

- **Chats and explains** like a normal assistant, without running anything.
- **Checks computers** by name: online status, uptime, disks, services, processes, logged-on users, event logs and Active Directory lookups. Read-only commands run without asking.
- **Fixes things** with your approval: starts and stops services, ends stuck processes, restarts PCs. It reads the state first, asks before the change and checks the result afterwards.
- **Uses your notes**: runbooks and known fixes in the `notes` folder, searched before it guesses.
- **Shows its work**: every command, its output, and a speed line after each answer.

## Models

| Model | Size | Best for |
| --- | --- | --- |
| [Qwen3.6-35B-A3B](https://github.com/AOSPAndroid/Axis/releases/tag/qwen3.6-35b-a3b-q4-k-m) | 22.1 GB | Everyday use: fast and good at terminal tasks. Recommended. |
| [Qwen3.8-Flash-Next](https://github.com/AOSPAndroid/Axis/releases/tag/qwen3.8-flash-next-gsq-rco-q2-0) | 66.4 GB | The biggest and strongest (125B). Needs 64 GB of RAM; slower to start. |
| [K2-Horizon-MoVA-36B-A4B](https://github.com/AOSPAndroid/Axis/releases/tag/k2-horizon-mova-36b-a4b-q4-k-m) | 22.4 GB | Hard problems: the best at terminal tasks. It thinks before every answer and shows its reasoning. |
| [Qwen3.8-27B](https://github.com/AOSPAndroid/Axis/releases/tag/qwen3.8-27b-q4-k-m) | 16.5 GB | Accurate, but slow without a big graphics card. |
| [Gemma 4 26B-A4B](https://github.com/AOSPAndroid/Axis/releases/tag/gemma-4-26b-a4b-qat-q4-0) | 14.4 GB | An alternative from Google. |

The large models need 32 GB of RAM or more. A graphics card with 4 GB or more is used automatically. See the [guide](docs/GUIDE.md#choosing-a-model) for all models.

## More

- [User guide](docs/GUIDE.md): installation, models, everyday use, notes, options and troubleshooting.
- [Technical README](agent/README.md): how the agent and launcher work.
- [All downloads](https://github.com/AOSPAndroid/Axis/releases)
