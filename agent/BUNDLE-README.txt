Local agent for Windows
=======================

Contents: the agent, a launcher, and llama.cpp builds for the processor
(llama-cpu) and for graphics cards (llama-vulkan). Models are separate.

1. Download ALL the parts of one or more models into Downloads
   (https://github.com/AOSPAndroid/tools/releases):

   Qwen3.6-35B-A3B              22.1 GB, 12 parts  best quality, fast on a processor
   Gemma 4 26B-A4B              14.4 GB,  8 parts  Google, mixture of experts
   Qwen3.6-35B-A3B abliterated  21.2 GB, 12 parts  community edit without refusals
   Qwen3.5-9B                    5.7 GB,  3 parts  fits fully on an 8 GB graphics card
   Qwen3.8-9B distill            5.8 GB,  4 parts  the first model
   Qwen3.5-4B                    2.7 GB,  2 parts  fastest, weaker with tools

   The mixture-of-experts models need 32 GB of RAM or more.
   Wait until no file ends in .crdownload.

2. Extract local-agent-windows.zip anywhere, for example Documents.

3. Double-click "Start Agent.bat". If several models are present it asks
   which one to use. The first run of a model checks and joins its parts
   (about 2 GB of spare disk; resumes if interrupted) and removes them.
   It then starts llama-server and opens the agent. Close the window to
   stop both.

To skip the question: python start.py --model 35b
(keys: 35b, gemma, 35b-abliterated, 9b, 9b-distill, 4b)

The agent works in the "workspace" folder next to start.py. To use another
folder: python start.py --workdir C:\path\to\folder

Options: --cpu forces the processor build, --gpu tries the graphics card
even if none was detected, --ctx 4096 uses less memory.
If something fails, server.log in this folder has llama-server's output.

The agent asks before it writes a file or runs a command. Commands run with
your own permissions, so read each one before approving it.
