Local agent for Windows
=======================

Contents: the agent, a launcher, and llama.cpp builds for the processor
(llama-cpu) and for graphics cards (llama-vulkan). The model is separate.

1. Download the parts of one model into Downloads:

   Qwen3.6-35B-A3B (recommended, needs 32 GB+ RAM), 12 parts, 22 GB:
   https://github.com/AOSPAndroid/tools/releases/tag/qwen3.6-35b-a3b-q4-k-m

   Qwen3.8-9B distill (smaller, 16 GB RAM), 4 parts, 5.8 GB:
   https://github.com/AOSPAndroid/tools/releases/tag/qwen3.8-9b-q4-k-m

   Wait until none of them ends in .crdownload.

2. Extract local-agent-windows.zip anywhere, for example Documents.

3. Double-click "Start Agent.bat".
   The first run checks and joins the parts (needs about 2 GB of spare disk;
   if interrupted it resumes) and removes them. It then starts llama-server
   and opens the agent. Close the window to stop both.

If both models are present it uses Qwen3.6-35B-A3B. To pick one:
    python start.py --model 9b

The agent works in the "workspace" folder next to start.py. To use another
folder, run from a terminal:
    python start.py --workdir C:\path\to\folder

Options: --cpu forces the processor build, --gpu tries the graphics card
even if none was detected, --ctx 4096 uses less memory.
If something fails, server.log in this folder has llama-server's output.

The agent asks before it writes a file or runs a command. Commands run with
your own permissions, so read each one before approving it.
