#!/usr/bin/env python3
"""Start the local agent: prepare the model, start llama-server, then open the agent.

Double-click "Start Agent.bat", or run:  python start.py [--workdir DIR] [--model 35b|9b] [--cpu]
Needs no internet access. The model parts are picked up from Downloads (or
this folder, or %USERPROFILE%\\local-ai) and joined on first run.
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PART_SIZE = 1900000000
PARTS_35B = [  # SHA-256 of each release part, from PARTS-SHA256SUMS.txt
    "9410960161ddd35a7c0876d6717d99340512d789904bb5b65c154d9527d89753",
    "730ee3d393f9a49dbf9150ca326ca7de7e8903cc54e5dbcf6ceb74db02f5fc2c",
    "722c5c3efe67c22f492c693708676528df81e69edb7b326ca503008792eea3b8",
    "bd7686c48fe02eb08aa4a9d6302698c55e2564b454f8e0fbbb7fb46652dfe3fe",
    "ce046b8ac93c1e452d5e45f1f416dce949b4ef2df9222b9b4ef2806a15eb4911",
    "c61d79d44485877ab1b38c99b77207f3ab584bb39ef96bdbd8019d459530800e",
    "028293916e1d914f14c8387da67ff4c9bbcb398275abb4399ebae2cffe24340f",
    "3d9f97d212f69f55b91b0e5e216f934047590ba7ec4f2f72b35d6819a98528c0",
    "4e80b8e3071bc3d03c63e948672771a893873ff1fadcaa1293f53963bad5228b",
    "ea37d6b0ad6a3949798b141c438fd05194ca452bf572bf1e3d1886b3f7f2ff26",
    "bd87cf0f7606845216f0be02aef9b4183c4d290c1ac6c0157b3f1be60495eff9",
    "993294c84033115840d836f1f8ecb929c133d22111344663781a6505474ae189",
]
RELEASES = "https://github.com/AOSPAndroid/tools/releases/tag/"
# Preferred first. "parts" are the SHA-256 of each 1.9 GB release part, in order.
MODELS = {
    "35b": {
        "file": "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
        "size": 22134528992,
        "sha256": "ac0e2c1189e055faa36eff361580e79c5bd6f8e76bffb4ce547f167d53e31a61",
        "release": RELEASES + "qwen3.6-35b-a3b-q4-k-m",
        "parts": PARTS_35B,
        # Mixture of experts: shared layers on the graphics card, experts in RAM.
        "gpu": "moe",
    },
    "9b": {
        "file": "Qwen3.8-9B-Q4_K_M.gguf",
        "size": 5780090176,
        "sha256": "df13d66021cef676f82be74053220fd75af6bf2a6a7fb77f5222ab9e50744a7a",
        "release": RELEASES + "qwen3.8-9b-q4-k-m",
        "parts": [
            "15ea33a95bd2113a1216981ab1674aa56959e16e006fdf4f4b320b139d315f35",
            "51b933b61b4192ad2a71401ab8f47843ee43bc317d0ef292dd16a8c992ec8f0c",
            "94b5be0fea2b7f36ff152adb4c36714d9cebb52a0e56363a546743e942c22978",
            "c319a4ee35a766cfa4f841c262a838424a60d908ebdebf2256a5adf8a7ae8bd9",
        ],
        "gpu": "full",
    },
}
PORT = 8080
HOME = os.path.expanduser("~")
SEARCH_DIRS = [HERE, os.path.dirname(HERE), os.path.join(HOME, "Downloads"), os.path.join(HOME, "local-ai")]
GPU_WORDS = ("nvidia", "radeon", "amd", "intel(r) arc")
MOE_MIN_VRAM = 3500000000  # Windows caps the reported value at 4 GB
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


def part_list(m):
    """[(file name, size, sha256)] for each release part of model m."""
    count = len(m["parts"])
    return [("%s.part%03d" % (m["file"], i + 1),
             PART_SIZE if i < count - 1 else m["size"] - PART_SIZE * (count - 1),
             digest) for i, digest in enumerate(m["parts"])]


def sha256(path, label):
    h = hashlib.sha256()
    size, done = os.path.getsize(path), 0
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(CHUNK), b""):
            h.update(block)
            done += len(block)
            print("\r  %s %3d%%" % (label, 100 * done // max(size, 1)), end="", flush=True)
    log()
    return h.hexdigest()


def join_parts(m):
    """Join verified parts in place (needs only one part of spare disk) and resume if interrupted."""
    parts = part_list(m)
    first_dir = None
    for d in SEARCH_DIRS:
        if os.path.exists(os.path.join(d, m["file"] + ".joining")):
            first_dir = d
    if first_dir is None:
        first = find_file(*parts[0][:2])
        first_dir = os.path.dirname(first)
    target = os.path.join(first_dir, m["file"] + ".joining")
    state_path = target + ".json"
    state = {"appended": 0, "size": 0}
    if os.path.exists(state_path):
        with open(state_path) as f:
            state = json.load(f)
        log("Resuming the join after part %d." % state["appended"])

    todo = parts[state["appended"]:]
    log("Checking %d model parts (one time only)..." % len(todo))
    paths = []
    for i, (name, size, digest) in enumerate(todo, state["appended"] + 1):
        path = os.path.join(first_dir, name) if i == 1 else find_file(name, size)
        if i == 1 and not os.path.exists(path):
            path = target  # part 1 was already renamed to the join target
        if path is None:
            sys.exit("Error: %s is missing. Download it from %s and rerun." % (name, m["release"]))
        if path != target and sha256(path, "part %d/%d" % (i, len(parts))) != digest:
            sys.exit("Error: %s is damaged. Delete it, download it again and rerun." % path)
        paths.append(path)

    log("Joining...")
    for i, path in enumerate(paths, state["appended"] + 1):
        if i == 1:
            os.replace(path, target)
            path = target
        else:
            with open(target, "r+b") as out:
                out.truncate(state["size"])  # drop a half-written append from an interruption
                out.seek(state["size"])
                with open(path, "rb") as f:
                    shutil.copyfileobj(f, out, CHUNK)
                out.flush()
                os.fsync(out.fileno())
        state = {"appended": i, "size": os.path.getsize(target)}
        with open(state_path, "w") as f:
            json.dump(state, f)
        if path != target:
            os.remove(path)
        print("\r  %3d%%" % (100 * state["size"] // m["size"]), end="", flush=True)
    log()
    if os.path.getsize(target) != m["size"]:
        sys.exit("Error: the joined model has the wrong size. Delete %s and download the parts again." % target)
    final = os.path.join(HERE, m["file"])
    try:
        os.replace(target, final)
    except OSError:  # different drive: leave it where it is
        final = os.path.join(first_dir, m["file"])
        os.replace(target, final)
    os.remove(state_path)
    log("Model ready: %s" % final)
    return final


def parts_status(m):
    found = [find_file(name, size) for name, size, _ in part_list(m)]
    joining = any(os.path.exists(os.path.join(d, m["file"] + ".joining")) for d in SEARCH_DIRS)
    return found, joining


def prepare_model(choice=None):
    """Return (model key, path). Uses the preferred model whose files are present."""
    keys = [choice] if choice else list(MODELS)
    for key in keys:
        m = MODELS[key]
        path = find_file(m["file"], m["size"])
        if path:
            return key, path
        if not m["parts"]:
            continue  # parts not published yet
        found, joining = parts_status(m)
        if joining or all(found):
            return key, join_parts(m)
        if any(found) or choice:
            missing = [name for (name, _, _), p in zip(part_list(m), found) if not p]
            log("The %s model is not ready yet. Missing or still downloading:" % m["file"])
            for name in missing:
                log("  " + name)
            log("\nDownload them from %s" % m["release"])
            log("(wait until none ends in .crdownload). Looked in:")
            for d in SEARCH_DIRS:
                log("  " + d)
            others = [k for k in MODELS if k != key]
            if others and not choice:
                log("\nTo use the other model meanwhile, run: start.py --model %s" % others[0])
            sys.exit(1)
    log("No model found. Download the parts of one of these into Downloads:")
    for m in MODELS.values():
        log("  %s  %s" % (m["file"], m["release"]))
    sys.exit(1)


# ---- llama-server ----------------------------------------------------------

def gpus():
    """[(name, memory in bytes)] of the display adapters. Memory is capped at 4 GB."""
    if os.name != "nt":
        return []
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command",
                              "Get-CimInstance Win32_VideoController | "
                              "ForEach-Object { '{0}|{1}' -f $_.AdapterRAM, $_.Name }"],
                             capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    result = []
    for line in out.splitlines():
        ram, _, name = line.strip().partition("|")
        if name:
            result.append((name.strip(), int(ram) if ram.isdigit() else 0))
    return result


def gpu_mode(model_key, adapters, force):
    """How to use the graphics card for this model: "full", "moe" or None (processor only)."""
    mode = MODELS[model_key]["gpu"]
    if force:
        return mode
    discrete = [ram for name, ram in adapters if any(w in name.lower() for w in GPU_WORDS)]
    if not discrete:
        return None
    if mode == "moe" and max(discrete) < MOE_MIN_VRAM:
        return None
    return mode


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


def start_server(exe, model, ctx, mode):
    log_path = os.path.join(HERE, "server.log")
    cmd = [exe, "-m", model, "-c", str(ctx), "--jinja", "--host", "127.0.0.1", "--port", str(PORT),
           "-ngl", "99" if mode else "0", "--temp", "0.6", "--top-p", "0.95", "--top-k", "20"]
    if mode == "moe":
        cmd += ["--n-cpu-moe", "999"]  # keep every expert layer in RAM
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
    p.add_argument("--model", choices=list(MODELS), help="which model to use (default: the best one present)")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--cpu", action="store_true", help="always run on the processor")
    g.add_argument("--gpu", action="store_true", help="try the graphics card even if none was detected")
    a, agent_args = p.parse_known_args()

    key, model = prepare_model(a.model)
    log("Model: %s" % os.path.basename(model))
    os.makedirs(a.workdir, exist_ok=True)

    proc = None
    if server_ready():
        log("Using the llama-server already running on port %d." % PORT)
    else:
        adapters = gpus()
        log("Graphics: %s" % (", ".join(name for name, _ in adapters) or "unknown"))
        mode = None if a.cpu else gpu_mode(key, adapters, a.gpu)
        builds = ["vulkan", "cpu"] if mode else ["cpu"]
        for build in builds:
            exe = find_server(os.path.join(HERE, "llama-" + build))
            if not exe:
                log("No llama-%s folder next to start.py; skipping." % build)
                continue
            where = {"full": "graphics card", "moe": "graphics card + processor"}.get(mode) if build == "vulkan" else "processor"
            log("Starting llama-server (%s), loading the model" % where)
            proc = start_server(exe, model, a.ctx, mode if build == "vulkan" else None)
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
