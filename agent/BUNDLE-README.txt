Axis for Windows
================

Contents: the agent, a launcher, and llama.cpp builds for the processor
(llama-cpu) and for graphics cards (llama-vulkan). Models are separate.
Keep agent.py, it_tools.py, it_windows.ps1, terminal_ui.py and web_tools.py
together.
Atlas is not needed.

The terminal opens with the AXIS ASCII logo and shows the model/workspace,
readable tool activity and job tables. Responses are labelled AXIS.
Narrow terminals and --plain use a compact AXIS heading.
/help lists commands. /jobs checks deployments without using the model;
/status shows settings; /output reads saved tool results; /paste enters a
multiline request (finish with a single . line). Ctrl+C cancels the current
request and returns to the prompt. /exit closes the chat. Accepted background
IT jobs continue. --plain disables colour/animation; --verbose expands tools
and shows reasoning when --think is enabled. NO_COLOR is also supported.

Public web search and page reading are available by default. For example:
  Search Microsoft's documentation for installer exit code 3010 and cite it.
  Read https://docs.python.org/3/ and summarize the release highlights.
  Follow that page's installation requirements link and summarize it.
Search results show titles, snippets and URLs. Page reads show an excerpt,
source URL, links and the next text/link offsets when more is available.
Ask the agent to continue a page, show more links or follow a returned link;
/output reads the full saved result. Fetching a page does not verify its claims.

No API key, browser or extra Python packages are needed. Web requests need
internet access and inherit system/environment HTTP(S) proxy settings.
HTTP proxies are supported; HTTPS-proxy URLs, PAC and integrated Windows
proxy authentication are not. Some proxies reject IP-based CONNECT for
HTTPS pages; the reader reports an error rather than bypassing the proxy.
Search provider availability may vary with network policy, rate limits and
site changes. Queries and requested URLs are sent to external services;
the tools do not upload local files or submit forms. Only public HTTP(S)
HTML/text pages are supported, not JavaScript-heavy sites, logged-in pages
or PDFs. Web content is untrusted reference material, not instructions to
run commands or change the agent's behaviour. Add --no-web to disable web
tools; local chat, notes, files and IT tools remain available.

1. Extract local-agent-windows.zip anywhere, for example Documents.
   Python 3.8 or newer must already be installed on the PC.

2. If you already have the FULL model, copy this file into the extracted
   local-agent folder beside "Start Agent.bat":
     Qwen3.6-35B-A3B-UD-Q4_K_M.gguf
   You do not need to download or join model parts again.

   Otherwise download ALL the parts of one or more models into Downloads
   (https://github.com/AOSPAndroid/tools/releases):

   Qwen3.6-35B-A3B              22.1 GB, 12 parts  fast; good at terminal tasks
   Qwen3.8-27B                  16.5 GB,  9 parts  newest; best at terminal tasks, slow
   Gemma 4 26B-A4B              14.4 GB,  8 parts  Google; fast
   Qwen3.6-35B-A3B abliterated  21.2 GB, 12 parts  fast; community edit without refusals
   Qwen3.5-9B abliterated        5.6 GB,  3 parts  smaller; community edit without refusals

   The large models need 32 GB of RAM or more.
   Wait until no file ends in .crdownload.

3. Double-click "Start Agent.bat". If several models are present it asks
   which one to use. A full model is used directly. If using parts instead,
   the first run checks and joins them
   (about 2 GB of spare disk; resumes if interrupted) and removes them.
   It then starts llama-server and opens the agent. Close the window to
   stop both.

BUNDLE-COMMIT.txt identifies the source commit used to build this ZIP.

To skip the question: python start.py --model 35b
(keys: 35b, 27b, gemma, 35b-abliterated, 9b-abliterated, 9b-distill)

Notes: put your runbooks, procedures, known fixes and names as .md or .txt
files in the "notes" folder. The agent searches them before guessing, and
always reads notes\ALWAYS.md (keep it short). notes\EXAMPLE.md shows the
format. Re-extracting the zip only replaces EXAMPLE.md.

To see the model's reasoning, start with: "Start Agent.bat" --think
(slower: it thinks before every answer).

The agent works in the "workspace" folder next to start.py. To use another
folder: python start.py --workdir C:\path\to\folder

A graphics card with 4 GB or more is used automatically (as much of the
model as fits; the rest stays in RAM). Options: --cpu forces the processor,
--gpu tries the graphics card anyway, --ctx 4096 uses less memory.
If something fails, server.log in this folder has llama-server's output.

Standalone IT actions: inspect PCs, deploy/install/uninstall/repair packages,
control services/processes, check AD, reboot with monitoring and open remote
support tools. The package folder is already configured; start with:
  python start.py --model 35b
Default package folder:
  C:\Users\x01426046\OneDrive - Barclays Bank PLC\Shortcuts\EPP_PACKAGE_REPO_BetaPackages - BetaPackages
--package-repo, AGENT_PACKAGE_REPO or WMI_PACKAGE_REPO can override it.
WMI/file sharing and your Windows account's rights must permit the operation;
AD lookup needs RSAT. The default context is 16384 tokens; --ctx 8192 reduces it.

Ask for package discovery and a copy-only test before your first deployment.
A job ID means queued; ask for its status and each PC's result. Script exit 0
does not verify application health. Unknown outcomes must be inspected before
retrying. Jobs run separately from chat and continue when the chat closes.
State, snapshots and full tool results are kept in the state folder; preserve
it when updating. Each attempt's full remote log stays under
C:\Temp\LocalAgent\Jobs on the target. Only this agent's package staging
(C:\Temp\LocalAgent\Packages) is removed by its cleanup action.

Read-only commands (Get-*, Test-Connection, ipconfig /all, whoami, quser...)
run without asking. The agent asks before anything else: changes, scripts,
writing files. Commands run with your own permissions, so read each
one before approving it.
