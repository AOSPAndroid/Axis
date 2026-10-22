Local agent for Windows
=======================

Contents: the agent, a launcher, and llama.cpp builds for the processor
(llama-cpu) and for graphics cards (llama-vulkan). The model is separate.

1. Download the four model parts from
   https://github.com/AOSPAndroid/tools/releases/tag/qwen3.8-9b-q4-k-m
   (Qwen3.8-9B-Q4_K_M.gguf.part001 to .part004). Leave them in Downloads.

2. Extract local-agent-windows.zip anywhere, for example Documents.

3. Double-click "Start Agent.bat".
   The first run joins and verifies the model (about 12 GB free disk
   needed, a minute or two) and removes the .part files. It then starts
   llama-server and opens the agent. Close the window to stop both.

The agent works in the "workspace" folder next to start.py. To use another
folder, run from a terminal:
    python start.py --workdir C:\path\to\folder

Options: --cpu forces the processor build, --gpu tries the graphics card
even if none was detected, --ctx 4096 uses less memory.
If something fails, server.log in this folder has llama-server's output.

The agent asks before it writes a file or runs a command. Commands run with
your own permissions, so read each one before approving it.
