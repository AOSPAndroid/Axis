# Axis

**[Download Axis for Windows — local-agent-windows.zip](https://github.com/AOSPAndroid/Axis/releases/download/local-agent-windows/local-agent-windows.zip)**

**A local AI assistant for IT support on Windows.** Axis runs your model on your own PC with llama.cpp. It chats, researches public web pages, deploys packages and checks PCs on your network. Supported read-only operations run straight away; changes ask for approval by default. Web searches send queries to a search provider and page reads contact the requested website.

Axis has its own deployment, directory and machine inspection tools. **Atlas does not need to be installed or running.**

**Atlas database lookup:** place your `office_atlas.db` beside `Start Agent.bat`, or use `"Start Agent.bat" --atlas-db "F:\Atlas\DB\office_atlas.db"`. Axis can search people, accounts and computers and read their stored assignment links, using a read-only local connection. [Database setup](docs/GUIDE.md#atlas-database).

![Axis ASCII interface showing public web research](docs/images/06-ascii-ui.png)

Actual terminal renderer with scripted example data. Your questions appear in purple, Axis's answers in cyan, and thinking in grey, with small role icons in supported terminals. Axis keeps its simple ASCII logo, labelled tool panels and small rotating spinner. Thinking is displayed as it arrives, with expanded tool results; final replies focus on the result or the next decision. Use `--compact` for shorter tool summaries. The interface uses only Python's standard library; animations stop while you type. Run `Start Agent.bat --plain` for a compact display without colour, icons or motion.

## Quick start

1. Download **[local-agent-windows.zip](https://github.com/AOSPAndroid/Axis/releases/download/local-agent-windows/local-agent-windows.zip)** and extract it.
2. Copy your full **`Qwen3.6-35B-A3B-UD-Q4_K_M.gguf`** into the `local-agent` folder beside **`Start Agent.bat`**. The launcher uses the existing Python at `C:\devhome\tools\python3.12\current\python.exe` first, with automatic discovery elsewhere if needed (Python 3.8 or newer).
3. Double-click **`Start Agent.bat`**, wait for the AXIS banner and `You >` prompt, then type a request.

**Start both with your DSK account:** run **`Start Axis + Atlas.bat`** from the same ZIP under DSK. It starts your existing Atlas installation, then Axis, using the same Windows account and Atlas's active database. If needed, it asks once for the folder containing `Start-Office-Atlas.bat` and remembers it. [Shared launcher details](docs/GUIDE.md#start-axis-and-atlas-together).

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
- **Uses reusable skills**: `/skills` lists eight workflow guides; `/skills pc-health` reads one. Add custom guides in `state/skills` or select a folder with `--skills`.
- **Shows its work**: labelled tool activity, result summaries, saved full output through `/output`, and a speed line after each answer.

## Models

| Model | Size | Best for |
| --- | --- | --- |
| [Qwen3.6-35B-A3B](https://github.com/AOSPAndroid/Axis/releases/tag/qwen3.6-35b-a3b-q4-k-m) | 22.1 GB | Everyday use: fast and good at terminal tasks. Recommended. |
| [Qwen3.8-Flash-Next](https://github.com/AOSPAndroid/Axis/releases/tag/qwen3.8-flash-next-gsq-rco-q2-0) | 66.4 GB | Two GGUF files, 36 download parts. Uses memory mapping and reads its large table from disk on demand; performance depends on RAM, SSD and context. |
| [Qwen3.8-Flash-Next abliterated](https://github.com/AOSPAndroid/Axis/releases/tag/qwen3.8-flash-next-gsq-rco-abliterated-q2-0) | 66.8 GB | Community variant; its second GGUF is identical to Flash's and can be reused. Select `--model flash-abliterated`. |
| [K2-Horizon-MoVA-36B-A4B](https://github.com/AOSPAndroid/Axis/releases/tag/k2-horizon-mova-36b-a4b-q4-k-m) | 22.4 GB | An alternative reasoning model with its own sampling defaults. |
| [Qwen3.8-27B](https://github.com/AOSPAndroid/Axis/releases/tag/qwen3.8-27b-q4-k-m) | 16.5 GB | A dense model to compare on harder tasks; speed depends on hardware. |
| [Gemma 4 26B-A4B](https://github.com/AOSPAndroid/Axis/releases/tag/gemma-4-26b-a4b-qat-q4-0) | 14.4 GB | An alternative from Google. |
| [Qwen3.8-35B-A3B distill](https://github.com/AOSPAndroid/Axis/releases/tag/qwen3.8-35b-a3b-distill-q4-k-m) | 21.7 GB | Community distill of Qwen3.8 into the fast 35B-A3B; always thinks. Select `--model 35b-distill`. |
| [Qwen3.8-27B Q8_0](https://github.com/AOSPAndroid/Axis/releases/tag/qwen3.8-27b-q8-0) / [BF16](https://github.com/AOSPAndroid/Axis/releases/tag/qwen3.8-27b-bf16) | 29.0 / 54.7 GB | The 27B at 8-bit (near full quality) or its original 16-bit weights. Slow on a processor; Q8_0 needs 32 GB of RAM or more, BF16 64 GB or more. Select `--model 27b-q8` or `--model 27b-bf16`. |
| [Qwen3.8-27B IQ3_S](https://github.com/AOSPAndroid/Axis/releases/tag/qwen3.8-27b-gsq-rco-iq3-s) | 11.8 GB | The official 27B in a smaller GSQ-RCO build for 16 GB of memory. Select `--model 27b-iq3`. |

The large models need 32 GB of RAM or more. A graphics card with 4 GB or more is used automatically. See the [guide](docs/GUIDE.md#choosing-a-model) for all models.

For Flash, download all 36 parts into Downloads and run `python start.py --model flash`, or choose it in the model menu. Its two GGUF files must stay together. A 64 GB PC should be assessed with its normal workload; fit and speed have not been verified on your hardware.

## More

- [User guide](docs/GUIDE.md): installation, models, everyday use, notes, options and troubleshooting.
- [Technical README](agent/README.md): how the agent and launcher work.
- [All downloads](https://github.com/AOSPAndroid/Axis/releases)
