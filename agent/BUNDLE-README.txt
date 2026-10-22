Local agent for Windows
=======================

Contents: the agent, a launcher, and llama.cpp builds for the processor
(llama-cpu) and for graphics cards (llama-vulkan). Models are separate.
Keep agent.py, it_tools.py and it_windows.ps1 together. Atlas is not needed.

1. Download ALL the parts of one or more models into Downloads
   (https://github.com/AOSPAndroid/tools/releases):

   Qwen3.6-35B-A3B              22.1 GB, 12 parts  fast; good at terminal tasks
   Qwen3.8-27B                  16.5 GB,  9 parts  newest; best at terminal tasks, slow
   Gemma 4 26B-A4B              14.4 GB,  8 parts  Google; fast
   Qwen3.6-35B-A3B abliterated  21.2 GB, 12 parts  fast; community edit without refusals
   Qwen3.5-9B abliterated        5.6 GB,  3 parts  smaller; community edit without refusals

   The large models need 32 GB of RAM or more.
   Wait until no file ends in .crdownload.

2. Extract local-agent-windows.zip anywhere, for example Documents.

3. Double-click "Start Agent.bat". If several models are present it asks
   which one to use. The first run of a model checks and joins its parts
   (about 2 GB of spare disk; resumes if interrupted) and removes them.
   It then starts llama-server and opens the agent. Close the window to
   stop both.

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
support tools. Configure the package folder when starting:
  python start.py --model 35b --package-repo "D:\Packages"
AGENT_PACKAGE_REPO (or WMI_PACKAGE_REPO) can set the same folder.
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
