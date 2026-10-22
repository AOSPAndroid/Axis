#!/usr/bin/env python3
"""Minimal local agent for an OpenAI-compatible server (llama-server or LM Studio).

Python 3.8+ standard library only. Usage:
    python agent.py                      # interactive
    python agent.py "summarise notes.txt" # one task, then exit
"""
import argparse
import http.client
import json
import os
import platform
import re
import subprocess
import sys
import urllib.error
import urllib.request
import uuid

MAX_TOOL_OUTPUT = 6000   # chars of tool output sent back to the model
MAX_STEPS = 15           # tool calls per task before giving up

SYSTEM_PROMPT = """You are a helpful agent running locally on the user's computer.
Working directory: {workdir}
Operating system: {os}

Use the tools to look at files and run commands when that helps answer the request.
Paths are relative to the working directory. Check results before moving on.
When the task is done, reply with a short answer and do not call a tool."""

TOOLS = [
    {"type": "function", "function": {
        "name": "list_dir",
        "description": "List files and folders in a directory.",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string", "description": "Directory, default '.'"}}}}},
    {"type": "function", "function": {
        "name": "read_file",
        "description": "Read a text file.",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string"}}, "required": ["path"]}}},
    {"type": "function", "function": {
        "name": "write_file",
        "description": "Create or overwrite a text file with the given content.",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string"},
            "content": {"type": "string"}}, "required": ["path", "content"]}}},
    {"type": "function", "function": {
        "name": "run_command",
        "description": "Run a shell command in the working directory and return its output.",
        "parameters": {"type": "object", "properties": {
            "command": {"type": "string"}}, "required": ["command"]}}},
]


class Agent:
    def __init__(self, base_url, model, workdir, auto_approve, think, ctx=8192):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.workdir = os.path.realpath(workdir)
        self.auto_approve = auto_approve
        self.think = think
        # ~3.5 chars per token, leaving room for tool schemas and the reply.
        self.history_budget = int(ctx * 2.5)
        # The server is local; never route it through a system proxy.
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.reset()

    def reset(self):
        system = SYSTEM_PROMPT.format(workdir=self.workdir, os=platform.system())
        self.messages = [{"role": "system", "content": system}]

    # ---- model -----------------------------------------------------------

    def chat(self):
        body = {"model": self.model, "messages": self.messages, "tools": TOOLS,
                "temperature": 0.6, "top_p": 0.95, "top_k": 20}
        if not self.think:
            body["chat_template_kwargs"] = {"enable_thinking": False}
        req = urllib.request.Request(
            self.base_url + "/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": "Bearer local"})
        try:
            with self.http.open(req, timeout=900) as resp:
                return json.load(resp)["choices"][0]["message"]
        except urllib.error.HTTPError as e:
            raise RuntimeError("server returned %s: %s" % (e.code, e.read().decode("utf-8", "replace")[:500]))
        except urllib.error.URLError as e:
            raise RuntimeError("cannot reach %s (%s). Is llama-server running?" % (self.base_url, e.reason))
        except (OSError, http.client.HTTPException) as e:
            raise RuntimeError("connection to the server failed: %s" % e)
        except (ValueError, KeyError, IndexError):
            raise RuntimeError("unexpected response from the server")

    def run(self, task):
        self.messages.append({"role": "user", "content": task})
        for _ in range(MAX_STEPS):
            self.trim_history()
            msg = self.chat()
            content = strip_thinking(msg.get("content") or "")
            calls = msg.get("tool_calls") or []
            if not calls:
                content, calls = parse_inline_tool_calls(content)
            self.messages.append({"role": "assistant", "content": content,
                                  **({"tool_calls": calls} if calls else {})})
            if not calls:
                return content
            if content:
                print(dim(content))
            for call in calls:
                name = call["function"]["name"]
                args = call["function"].get("arguments") or {}
                if isinstance(args, str):
                    try:
                        args = json.loads(args) if args.strip() else {}
                    except json.JSONDecodeError:
                        args = None
                print(cyan("-> %s(%s)" % (name, preview_args(args))))
                result = self.call_tool(name, args)
                print(dim(truncate(result, 400)))
                self.messages.append({"role": "tool", "tool_call_id": call.get("id", ""),
                                      "name": name, "content": truncate(result, MAX_TOOL_OUTPUT)})
        return "Stopped after %d steps without finishing." % MAX_STEPS

    def trim_history(self):
        """Drop the oldest turns so the prompt fits a small context window."""
        def size():
            return sum(len(json.dumps(m)) for m in self.messages)
        last_user = max(i for i, m in enumerate(self.messages) if m["role"] == "user")
        while size() > self.history_budget and last_user > 1:
            del self.messages[1]
            last_user -= 1
            while last_user > 1 and self.messages[1]["role"] == "tool":
                del self.messages[1]
                last_user -= 1

    # ---- tools -----------------------------------------------------------

    def call_tool(self, name, args):
        if not isinstance(args, dict):
            return "Error: arguments must be a JSON object."
        try:
            if name == "list_dir":
                path = self.resolve(args.get("path") or ".")
                entries = sorted(os.listdir(path))
                return "\n".join(e + ("/" if os.path.isdir(os.path.join(path, e)) else "")
                                 for e in entries) or "(empty)"
            if name == "read_file":
                with open(self.resolve(args["path"]), encoding="utf-8", errors="replace") as f:
                    return f.read()
            if name == "write_file":
                path = self.resolve(args["path"])
                if not self.confirm("write %s (%d chars)" % (os.path.relpath(path, self.workdir), len(args["content"]))):
                    return "User declined the write."
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as f:
                    f.write(args["content"])
                return "Wrote %s" % args["path"]
            if name == "run_command":
                if not self.confirm("run: %s" % args["command"]):
                    return "User declined to run the command."
                proc = subprocess.run(args["command"], shell=True, cwd=self.workdir,
                                      capture_output=True, text=True, errors="replace", timeout=300)
                out = (proc.stdout + proc.stderr).strip()
                return "exit code %d\n%s" % (proc.returncode, out)
            return "Error: unknown tool %r." % name
        except KeyError as e:
            return "Error: missing argument %s." % e
        except subprocess.TimeoutExpired:
            return "Error: command timed out after 300 s."
        except Exception as e:
            return "Error: %s" % e

    def resolve(self, path):
        full = os.path.realpath(os.path.join(self.workdir, path))
        if os.path.commonpath([full, self.workdir]) != self.workdir:
            raise ValueError("path is outside the working directory")
        return full

    def confirm(self, action):
        if self.auto_approve:
            return True
        answer = input(yellow("Allow %s? [y/N] " % action)).strip().lower()
        return answer in ("y", "yes")


# ---- model output helpers ------------------------------------------------

def strip_thinking(text):
    """Remove Qwen <think> blocks; they should not be fed back into history."""
    if "</think>" in text:
        text = text.rsplit("</think>", 1)[1]
    return re.sub(r"<think>.*", "", text, flags=re.S).strip()


JSON_CALL_RE = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.S)
XML_CALL_RE = re.compile(r"<function=([\w.-]+)>(.*?)</function>", re.S)
XML_PARAM_RE = re.compile(r"<parameter=([\w.-]+)>\n?(.*?)\n?</parameter>", re.S)


def parse_inline_tool_calls(text):
    """Fallback for when the server leaves Qwen tool calls in the text."""
    calls = []
    for raw in JSON_CALL_RE.findall(text):
        try:
            data = json.loads(raw)
            calls.append((data["name"], data.get("arguments", {})))
        except (json.JSONDecodeError, KeyError, TypeError):
            pass
    if not calls:
        for name, body in XML_CALL_RE.findall(text):
            calls.append((name, dict(XML_PARAM_RE.findall(body))))
    if not calls:
        return text, []
    text = XML_CALL_RE.sub("", JSON_CALL_RE.sub("", text))
    text = text.replace("<tool_call>", "").replace("</tool_call>", "").strip()
    return text, [{"id": "call_" + uuid.uuid4().hex[:8], "type": "function",
                   "function": {"name": n, "arguments": json.dumps(a)}} for n, a in calls]


def truncate(text, limit):
    if len(text) <= limit:
        return text
    return text[:limit] + "\n... [truncated %d chars]" % (len(text) - limit)


def preview_args(args):
    if not isinstance(args, dict):
        return "?"
    return ", ".join("%s=%s" % (k, truncate(json.dumps(v), 60)) for k, v in args.items())


def _color(code):
    use = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None
    return lambda s: "\033[%sm%s\033[0m" % (code, s) if use else s


dim, cyan, yellow = _color("2"), _color("36"), _color("33")


def main():
    if os.name == "nt":
        os.system("")  # enable ANSI colours in the Windows console
    p = argparse.ArgumentParser(description="Local agent for an OpenAI-compatible server.")
    p.add_argument("task", nargs="*", help="run one task and exit")
    p.add_argument("--url", default=os.environ.get("AGENT_URL", "http://127.0.0.1:8080/v1"),
                   help="server base URL (LM Studio: http://127.0.0.1:1234/v1)")
    p.add_argument("--model", default=os.environ.get("AGENT_MODEL", "Qwen3.8-9B-Q4_K_M"))
    p.add_argument("--workdir", default=".", help="folder the agent may work in")
    p.add_argument("--yes", action="store_true", help="approve writes and commands without asking")
    p.add_argument("--ctx", type=int, default=8192, help="context size the server was started with (-c)")
    p.add_argument("--think", action="store_true", help="enable the model's thinking mode (slower)")
    a = p.parse_args()

    agent = Agent(a.url, a.model, a.workdir, a.yes, a.think, a.ctx)
    try:
        if a.task:
            print(agent.run(" ".join(a.task)))
            return
        print("Local agent in %s. /reset clears history, /exit quits." % agent.workdir)
        while True:
            task = input("\n> ").strip()
            if task in ("/exit", "/quit"):
                break
            if task == "/reset":
                agent.reset()
                continue
            if task:
                try:
                    print("\n" + agent.run(task))
                except RuntimeError as e:
                    print("Error: %s" % e)
    except RuntimeError as e:
        sys.exit("Error: %s" % e)
    except (KeyboardInterrupt, EOFError):
        print()


if __name__ == "__main__":
    main()
