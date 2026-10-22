#!/usr/bin/env python3
"""Start the local agent: prepare the model, start llama-server, then open the agent.

Double-click "Start Agent.bat", or run:  python start.py [--workdir DIR] [--cpu]
Needs no internet access. The model parts are picked up from Downloads (or
this folder, or %USERPROFILE%\\local-ai) and joined on first run.
"""
import argparse
import hashlib
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = "Qwen3.8-9B-Q4_K_M.gguf"
MODEL_SIZE = 5780090176
MODEL_SHA256 = "df13d66021cef676f82be74053220fd75af6bf2a6a7fb77f5222ab9e50744a7a"
PARTS = [(MODEL + ".part001", 1900000000), (MODEL + ".part002", 1900000000),
         (MODEL + ".part003", 1900000000), (MODEL + ".part004", 80090176)]
PORT = 8080
HOME = os.path.expanduser("~")
SEARCH_DIRS = [HERE, os.path.dirname(HERE), os.path.join(HOME, "Downloads"), os.path.join(HOME, "local-ai")]
GPU_WORDS = ("nvidia", "radeon", "amd", "intel(r) arc")
CHUNK = 8 << 20


def log(msg=""):
    print(msg, flush=True)


# ---- model -----------------------------------------------------------------

def find_file(name, size):
    for d in SEARCH_DIRS:
        path = os.path.join(d, name)
        if os.path.isfile(path) and os.path.getsize(path) == size:
            return path
    return None


def prepare_model():
    model = find_file(MODEL, MODEL_SIZE)
    if model:
        return model

    found, missing = [], []
    for name, size in PARTS:
        path = find_file(name, size)
        (found if path else missing).append(path or name)
    if missing:
        log("The model is not ready yet. Missing or incomplete:")
        for name in missing:
            log("  " + name)
        log("\nDownload them from https://github.com/AOSPAndroid/tools/releases/tag/qwen3.8-9b-q4-k-m")
        log("and wait until none of them ends in .crdownload. Looked in:")
        for d in SEARCH_DIRS:
            log("  " + d)
        sys.exit(1)

    model = os.path.join(HERE, MODEL)
    tmp = model + ".joining"
    log("Joining the model parts (one time only)...")
    h = hashlib.sha256()
    done = 0
    with open(tmp, "wb") as out:
        for path in found:
            with open(path, "rb") as f:
                for block in iter(lambda: f.read(CHUNK), b""):
                    h.update(block)
                    out.write(block)
                    done += len(block)
                    print("\r  %3d%%" % (100 * done // MODEL_SIZE), end="", flush=True)
    log()
    if h.hexdigest() != MODEL_SHA256:
        os.remove(tmp)
        sys.exit("Error: the joined model failed its checksum. Delete the .part files, download them again and retry.")
    os.replace(tmp, model)
    for path in found:
        os.remove(path)
    log("Model verified. Removed the .part files.")
    return model


# ---- llama-server ----------------------------------------------------------

def gpu_names():
    if os.name != "nt":
        return []
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command",
                              "(Get-CimInstance Win32_VideoController).Name"],
                             capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    return [line.strip() for line in out.splitlines() if line.strip()]


def find_server(folder):
    for base, _, files in os.walk(folder):
        for name in ("llama-server.exe", "llama-server"):
            if name in files:
                return os.path.join(base, name)
    return None


def server_ready():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open("http://127.0.0.1:%d/health" % PORT, timeout=5) as r:
            return r.status == 200
    except (urllib.error.URLError, OSError):
        return False


def start_server(exe, model, ctx, gpu):
    log_path = os.path.join(HERE, "server.log")
    cmd = [exe, "-m", model, "-c", str(ctx), "--jinja", "--host", "127.0.0.1", "--port", str(PORT),
           "-ngl", "99" if gpu else "0", "--temp", "0.6", "--top-p", "0.95", "--top-k", "20"]
    with open(log_path, "w") as log_file:
        try:
            proc = subprocess.Popen(cmd, stdout=log_file, stderr=subprocess.STDOUT, cwd=os.path.dirname(exe))
        except OSError as e:
            log("  could not start %s: %s" % (exe, e))
            return None
    deadline = time.time() + 600
    while time.time() < deadline:
        if proc.poll() is not None:
            with open(log_path, errors="replace") as f:
                tail = f.read().splitlines()[-8:]
            log("  llama-server stopped (exit code %s):" % proc.returncode)
            for line in tail:
                log("    " + line)
            return None
        if server_ready():
            log("  ready.")
            return proc
        print(".", end="", flush=True)
        time.sleep(2)
    proc.kill()
    log("  timed out after 10 minutes; see %s" % log_path)
    return None


def main():
    p = argparse.ArgumentParser(description="Start llama-server and the local agent.")
    p.add_argument("--workdir", default=os.path.join(HERE, "workspace"),
                   help="folder the agent works in (default: the workspace folder here)")
    p.add_argument("--ctx", type=int, default=8192, help="context size in tokens")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--cpu", action="store_true", help="always run on the processor")
    g.add_argument("--gpu", action="store_true", help="try the graphics card even if none was detected")
    a, agent_args = p.parse_known_args()

    model = prepare_model()
    os.makedirs(a.workdir, exist_ok=True)

    proc = None
    if server_ready():
        log("Using the llama-server already running on port %d." % PORT)
    else:
        gpus = gpu_names()
        has_gpu = any(w in n.lower() for n in gpus for w in GPU_WORDS)
        log("Graphics: %s" % (", ".join(gpus) or "unknown"))
        builds = ["cpu"] if a.cpu else ["vulkan", "cpu"] if (a.gpu or has_gpu) else ["cpu"]
        for build in builds:
            exe = find_server(os.path.join(HERE, "llama-" + build))
            if not exe:
                log("No llama-%s folder next to start.py; skipping." % build)
                continue
            log("Starting llama-server (%s), loading the model" % ("graphics card" if build == "vulkan" else "processor"))
            proc = start_server(exe, model, a.ctx, build == "vulkan")
            if proc:
                break
            if build == "vulkan":
                log("Falling back to the processor.")
        if not proc:
            sys.exit("Could not start llama-server. Details are in %s" % os.path.join(HERE, "server.log"))

    try:
        log("\nAgent working folder: %s" % os.path.abspath(a.workdir))
        subprocess.call([sys.executable, os.path.join(HERE, "agent.py"),
                         "--workdir", a.workdir, "--ctx", str(a.ctx)] + agent_args)
    except KeyboardInterrupt:
        pass
    finally:
        if proc:
            proc.terminate()
            try:
                proc.wait(10)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    main()
