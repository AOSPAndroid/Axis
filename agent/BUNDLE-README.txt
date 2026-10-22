Axis for Windows
================

Full guide with screenshots:
https://github.com/AOSPAndroid/Axis/blob/claude/local-agent/docs/GUIDE.md

Contents: the agent, a launcher, and llama.cpp builds for the processor
(llama-cpu) and for graphics cards (llama-vulkan). Models are separate.

1. Download ALL the parts of one or more models into Downloads
   (https://github.com/AOSPAndroid/Axis/releases):

   Qwen3.6-35B-A3B              22.1 GB, 12 parts  fast; good at terminal tasks
   K2-Horizon-MoVA-36B-A4B      22.4 GB, 12 parts  best at terminal tasks; thinks first
   Qwen3.8-Flash-Next           66.4 GB, 36 parts  biggest (125B); needs 64 GB of RAM
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
(keys: 35b, k2, flash, 27b, gemma, 35b-abliterated, 9b-abliterated, 9b-distill)

Notes: put your runbooks, procedures, known fixes and names as .md or .txt
files in the "notes" folder. The agent searches them before guessing, and
always reads notes\ALWAYS.md (keep it short). notes\EXAMPLE.md shows the
format. Re-extracting the zip only replaces EXAMPLE.md.

To see the model's reasoning, start with: "Start Agent.bat" --think
(slower: it thinks before every answer). K2-Horizon-MoVA always thinks,
and its reasoning is always shown in grey.

The agent works in the "workspace" folder next to start.py. To use another
folder: python start.py --workdir C:\path\to\folder

A graphics card with 4 GB or more is used automatically (as much of the
model as fits; the rest stays in RAM). Options: --cpu forces the processor,
--gpu tries the graphics card anyway, --ctx 4096 uses less memory.
If something fails, server.log in this folder has llama-server's output.

Read-only commands (Get-*, Test-Connection, ipconfig /all, whoami, quser...)
run without asking. The agent asks before anything else: changes, scripts,
writing files. Commands run with your own permissions, so read each
one before approving it.
