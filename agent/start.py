#!/usr/bin/env python3
"""Start the local agent: prepare the model, start llama-server, then open the agent.

Double-click "Start Agent.bat", or run:  python start.py [--workdir DIR] [--model KEY] [--cpu]
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
RELEASES = "https://github.com/AOSPAndroid/tools/releases/tag/"
# Menu order. "parts" are the SHA-256 of each 1.9 GB release part; "gpu" is
# "full" (whole model on the graphics card) or "moe" (experts stay in RAM).
with open(os.path.join(HERE, "models.json")) as _f:
    MODELS = {m["key"]: dict(m, release=RELEASES + m["tag"]) for m in json.load(_f)}
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


def model_status(m):
    """("ready", path), ("parts", None) when joinable, ("partial", found count) or (None, 0)."""
    path = find_file(m["file"], m["size"])
    if path:
        return "ready", path
    if not m["parts"]:
        return None, 0  # parts not published yet
    found, joining = parts_status(m)
    if joining or all(found):
        return "parts", None
    count = sum(1 for p in found if p)
    return ("partial", count) if count else (None, 0)


def report_missing(m):
    found, _ = parts_status(m)
    log("%s is not ready yet. Missing or still downloading:" % m["name"])
    for (name, _, _), p in zip(part_list(m), found):
        if not p:
            log("  " + name)
    log("\nDownload them from %s" % m["release"])
    log("(wait until none ends in .crdownload). Looked in:")
    for d in SEARCH_DIRS:
        log("  " + d)


def choose(keys):
    log("Models found:")
    for i, key in enumerate(keys, 1):
        log("  %d) %-30s %s" % (i, MODELS[key]["name"], MODELS[key]["note"]))
    while True:
        try:
            answer = input("Choose a model [1]: ").strip()
        except EOFError:
            answer = ""
        if not answer:
            return keys[0]
        if answer.isdigit() and 1 <= int(answer) <= len(keys):
            return keys[int(answer) - 1]


def prepare_model(choice=None):
    """Return (model key, path), asking which model to use when several are present."""
    status = {key: model_status(m) for key, m in MODELS.items()}
    if choice:
        key = choice
    else:
        usable = [k for k, (state, _) in status.items() if state in ("ready", "parts")]
        partial = [k for k, (state, _) in status.items() if state == "partial"]
        if not usable:
            if partial:
                report_missing(MODELS[partial[0]])
            else:
                log("No model found. Download all the parts of one of these into Downloads:")
                for m in MODELS.values():
                    log("  %-30s %s" % (m["name"], m["release"]))
            sys.exit(1)
        for k in partial:
            log("Still downloading: %s (%d of %d parts)" % (MODELS[k]["name"], status[k][1], len(MODELS[k]["parts"])))
        key = usable[0] if len(usable) == 1 else choose(usable)
    state, path = status[key]
    if state == "ready":
        return key, path
    if state == "parts":
        return key, join_parts(MODELS[key])
    if MODELS[key]["parts"]:
        report_missing(MODELS[key])
    else:
        log("%s has not been published yet: %s" % (MODELS[key]["name"], MODELS[key]["release"]))
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
    p.add_argument("--model", choices=list(MODELS), help="which model to use (default: ask when several are present)")
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
