# Axis

**[Download Axis for Windows — local-agent-windows.zip](https://github.com/AOSPAndroid/Axis/releases/download/local-agent-windows/local-agent-windows.zip)**

**A local AI assistant for IT support on Windows.** Axis runs your model on your own PC with llama.cpp. It chats, researches public web pages, deploys packages and checks PCs on your network. Supported read-only operations run straight away; changes ask for approval by default. Web searches send queries to a search provider and page reads contact the requested website.

Axis has its own deployment, directory and machine inspection tools. **Atlas does not need to be installed or running.**

![Axis ASCII interface showing public web research](docs/images/06-ascii-ui.png)

Actual terminal renderer with scripted example data. Axis has an ASCII logo, coloured tool panels and animated activity indicators. The interface uses only Python's standard library; animations stop while you type. Run `Start Agent.bat --plain` for a compact display without colour or motion.

## Quick start

1. Download **[local-agent-windows.zip](https://github.com/AOSPAndroid/Axis/releases/download/local-agent-windows/local-agent-windows.zip)** and extract it.
2. Copy your full **`Qwen3.6-35B-A3B-UD-Q4_K_M.gguf`** into the `local-agent` folder beside **`Start Agent.bat`**. Python 3.8 or newer must already be installed.
3. Double-click **`Start Agent.bat`**, wait for the AXIS banner and `You >` prompt, then type a request.

If you need a model, download all parts from its [release page](https://github.com/AOSPAndroid/Axis/releases/tag/qwen3.6-35b-a3b-q4-k-m). The launcher can check and join them. Read the **[full guide](docs/GUIDE.md)** for models, options, notes and troubleshooting.

For Firecrawl web research, double-click **`Configure Firecrawl.bat`**, paste your API key at the hidden prompt, then restart Axis. The key stays in your Windows user profile and survives ZIP updates. `/status` shows the active web provider. Basic browsing works without a key.

## What it looks like

| Checking a PC | Using your notes |
| --- | --- |
| ![Axis checking a PC's uptime and disks without asking](docs/images/02-check.png) | ![Axis answering from the notes folder](docs/images/04-notes.png) |

The two workflow screenshots above show an earlier console with scripted replies and sample data. The screenshot at the top shows the current ASCII interface. Colours depend on your terminal theme.

## What Axis does

- **Chats and explains** like a normal assistant, without running anything.
- **Checks computers** by name: online status, uptime, disks, services, processes, logged-on users, event logs and Active Directory lookups. Read-only commands run without asking.
- **Fixes things** with your approval: starts and stops services, ends stuck processes, restarts PCs. It reads the state first, asks before the change and checks the result afterwards.
- **Deploys packages** independently: install, uninstall, repair and copy-only workflows with persistent jobs and logs. `/jobs` checks progress.
- **Researches the public web**: searches, reads pages and follows source links. Configure Firecrawl for JavaScript-rendered pages and public PDFs, with automatic fallback to the basic HTML/text reader. Requests use your Firecrawl allowance. Website logins and form submissions are not supported.
- **Uses your notes**: runbooks and known fixes in the `notes` folder, searched before it guesses.
- **Shows its work**: labelled tool activity, result summaries, saved full output through `/output`, and a speed line after each answer.

## Models

| Model | Size | Best for |
| --- | --- | --- |
| [Qwen3.6-35B-A3B](https://github.com/AOSPAndroid/Axis/releases/tag/qwen3.6-35b-a3b-q4-k-m) | 22.1 GB | Everyday use: fast and good at terminal tasks. Recommended. |
| [Qwen3.8-Flash-Next](https://github.com/AOSPAndroid/Axis/releases/tag/qwen3.8-flash-next-gsq-rco-q2-0) | 66.4 GB | Two GGUF files, 36 download parts. Uses memory mapping and reads its large table from disk on demand; performance depends on RAM, SSD and context. |
| [K2-Horizon-MoVA-36B-A4B](https://github.com/AOSPAndroid/Axis/releases/tag/k2-horizon-mova-36b-a4b-q4-k-m) | 22.4 GB | An alternative reasoning model with its own sampling defaults. |
| [Qwen3.8-27B](https://github.com/AOSPAndroid/Axis/releases/tag/qwen3.8-27b-q4-k-m) | 16.5 GB | A dense model to compare on harder tasks; speed depends on hardware. |
| [Gemma 4 26B-A4B](https://github.com/AOSPAndroid/Axis/releases/tag/gemma-4-26b-a4b-qat-q4-0) | 14.4 GB | An alternative from Google. |

The large models need 32 GB of RAM or more. A graphics card with 4 GB or more is used automatically. See the [guide](docs/GUIDE.md#choosing-a-model) for all models.

For Flash, download all 36 parts into Downloads and run `python start.py --model flash`, or choose it in the model menu. Its two GGUF files must stay together. A 64 GB PC should be assessed with its normal workload; fit and speed have not been verified on your hardware.

## More

- [User guide](docs/GUIDE.md): installation, models, everyday use, notes, options and troubleshooting.
- [Technical README](agent/README.md): how the agent and launcher work.
- [All downloads](https://github.com/AOSPAndroid/Axis/releases)
