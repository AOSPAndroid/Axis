#!/usr/bin/env python3
"""Axis Cloud: chat with the models in your GitHub Copilot license, for example GPT-6.1 Sol.

Uses GitHub's official Copilot SDK, so requests count against your Copilot plan like any
other Copilot use. Your messages go to GitHub Copilot in the cloud, not to a local model.
It is a plain chat: the model cannot run commands, open files or browse.

    pip install github-copilot-sdk        (needs Python 3.11 or newer)
    python copilot_chat.py [--model ID] [--effort low|medium|high|xhigh]

Sign-in, in the order the SDK tries it: a token in COPILOT_GITHUB_TOKEN (or GH_TOKEN),
a previous `copilot` CLI login, or a GitHub CLI (`gh auth login`) login. If none works,
this asks for a fine-grained personal access token and can keep it, encrypted for your
Windows account, for next time.
"""
import argparse
import asyncio
import getpass
import importlib
import logging
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from agent import COLOR, dim, render_bold, yellow  # noqa: E402

PREFERRED = ("sol", "gpt-6")  # picked by default when the license offers them, in this order
TOKEN_FILE = os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "Axis", "copilot-token.bin")
SYSTEM_NOTE = (
    "This is a plain chat in a terminal for an IT support analyst. You have no tools: you cannot run "
    "commands, read files or browse. When a command would help, write it out for the user to run "
    "(Windows PowerShell 5.1 unless they say otherwise) and say what it does. Do not invent facts, "
    "names, paths or command output; say when you are unsure. Keep answers short and clear: plain "
    "text with short lists, no wide tables.")


def need_sdk():
    if sys.version_info < (3, 11):
        sys.exit("The Copilot SDK needs Python 3.11 or newer; this is %d.%d." % sys.version_info[:2])
    try:
        import copilot  # noqa: F401
        return
    except ImportError:
        pass
    command = [sys.executable, "-m", "pip", "install", "github-copilot-sdk"]
    if sys.prefix == sys.base_prefix:
        command.insert(4, "--user")  # outside a virtual environment, install for this user only
    print("GitHub's Copilot SDK is not installed. It is installed with:\n  " + " ".join(command))
    if input("Install it now? [y/N] ").strip().lower() != "y":
        sys.exit(1)
    if subprocess.call(command) != 0:
        sys.exit("The install failed. If this PC can't reach the internet from the command line, "
                 "ask IT how Python packages are installed here.")
    import site
    importlib.invalidate_caches()
    if site.getusersitepackages() not in sys.path:
        sys.path.append(site.getusersitepackages())


def use_system_proxy():
    """Give the Copilot runtime the Windows proxy, as browsers use it, unless one is already set."""
    if os.name != "nt" or os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy"):
        return None
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r"Software\Microsoft\Windows\CurrentVersion\Internet Settings") as key:
            enabled = winreg.QueryValueEx(key, "ProxyEnable")[0]
            server = winreg.QueryValueEx(key, "ProxyServer")[0] if enabled else ""
    except OSError:
        return None
    if not server:
        return None
    # "host:port", or per protocol: "http=host:port;https=host:port"
    entries = dict(part.split("=", 1) for part in server.split(";") if "=" in part)
    server = entries.get("https") or entries.get("http") or server.split(";")[0]
    proxy = server if "://" in server else "http://" + server
    os.environ["HTTPS_PROXY"] = os.environ["HTTP_PROXY"] = proxy
    os.environ.setdefault("NO_PROXY", "localhost,127.0.0.1")
    return proxy


# ---- token kept for next time, encrypted with Windows DPAPI (only this Windows user can read it) ----

def _dpapi(data, protect):
    import ctypes
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    call = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    call.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.POINTER(Blob), ctypes.c_void_p,
                     ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    call.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    buf = ctypes.create_string_buffer(data, len(data))
    blob_in = Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    blob_out = Blob()
    if not call(ctypes.byref(blob_in), "Axis" if protect else None, None, None, None, 0, ctypes.byref(blob_out)):
        raise OSError("Windows could not %s the saved token" % ("encrypt" if protect else "decrypt"))
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        kernel32.LocalFree(blob_out.pbData)


def load_token():
    if os.name != "nt" or not os.path.isfile(TOKEN_FILE):
        return None
    try:
        with open(TOKEN_FILE, "rb") as f:
            return _dpapi(f.read(), protect=False).decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def save_token(token):
    os.makedirs(os.path.dirname(TOKEN_FILE), exist_ok=True)
    with open(TOKEN_FILE, "wb") as f:
        f.write(_dpapi(token.encode("utf-8"), protect=True))


def forget_token():
    if os.path.isfile(TOKEN_FILE):
        os.remove(TOKEN_FILE)
        return True
    return False


# ---- output -----------------------------------------------------------------

class Printer:
    """Streams one reply: reasoning in grey after "thinking:", then the answer, then a usage line."""

    def __init__(self):
        self.done = asyncio.Event()
        self.thinking = False
        self.answered = False
        self.bold = False
        self.error = None
        self.usage = {"input": 0, "output": 0, "reasoning": 0}
        self.model = None
        self.started = time.time()

    def on_event(self, event):
        from copilot.session_events import (AssistantMessageDeltaData, AssistantReasoningDeltaData,
                                            AssistantUsageData, SessionErrorData, SessionIdleData)
        if getattr(event, "agent_id", None):
            return  # sub-agents are not used in a plain chat
        data = event.data
        if isinstance(data, AssistantReasoningDeltaData) and data.delta_content:
            if self.answered:
                return
            if not self.thinking:
                print(dim("thinking: "), end="")
                self.thinking = True
            print(dim(data.delta_content), end="", flush=True)
        elif isinstance(data, AssistantMessageDeltaData) and data.delta_content:
            text = data.delta_content
            if self.thinking:
                print("\n")  # a blank line between the reasoning and the answer
                self.thinking = False
            if not self.answered:
                text = text.lstrip()
                if not text:
                    return
                self.answered = True
            out, self.bold = render_bold(text, self.bold)
            print(out, end="", flush=True)
        elif isinstance(data, AssistantUsageData):
            self.model = data.model_display_name or data.model or self.model
            self.usage["input"] += data.input_tokens or 0
            self.usage["output"] += data.output_tokens or 0
            self.usage["reasoning"] += data.reasoning_tokens or 0
        elif isinstance(data, SessionErrorData):
            self.error = data.message or data.error_type
            self.done.set()
        elif isinstance(data, SessionIdleData):
            self.done.set()

    def finish(self):
        if self.bold:
            print(render_bold("", True, close=True)[0], end="")
        if self.thinking or self.answered:
            print()
        if self.error:
            print(yellow("Copilot reported an error: %s" % self.error))
        line = "%s; read %d tokens, wrote %d" % (self.model or "model", self.usage["input"], self.usage["output"])
        if self.usage["reasoning"]:
            line += " (%d reasoning)" % self.usage["reasoning"]
        print(dim("(%s; %.0f s)" % (line, time.time() - self.started)))


# ---- Copilot ----------------------------------------------------------------

async def connect(token=None):
    from copilot import CopilotClient
    client = CopilotClient(github_token=token) if token else CopilotClient()
    await client.start()
    auth = await client.get_auth_status()
    if auth.isAuthenticated:
        return client, auth
    await client.stop()
    return None, auth


async def sign_in():
    """Connect with the SDK's own sign-in methods, then a saved token, then a token typed in."""
    client, auth = await connect()
    if client:
        return client, auth
    saved = load_token()
    if saved:
        client, auth = await connect(saved)
        if client:
            return client, auth
        print(yellow("The saved token no longer works; it has been forgotten."))
        forget_token()
    print("Not signed in to GitHub Copilot%s." % (" (%s)" % auth.statusMessage if auth.statusMessage else ""))
    print("Create a fine-grained personal access token at https://github.com/settings/personal-access-tokens\n"
          "with the account that has your Copilot license, give it the 'Copilot Requests' permission,\n"
          "and paste it here. It is not shown while you type.")
    while True:
        token = getpass.getpass("Token (Enter to quit): ").strip()
        if not token:
            sys.exit(0)
        client, auth = await connect(token)
        if client:
            break
        print(yellow("That token did not work%s." % (": " + auth.statusMessage if auth.statusMessage else "")))
    if os.name == "nt" and input("Keep it, encrypted for your Windows account, for next time? [y/N] ").strip().lower() == "y":
        save_token(token)
        print(dim("Saved to %s. Type /forget to delete it." % TOKEN_FILE))
    return client, auth


def usable(models):
    return [m for m in models if not (m.policy and m.policy.state == "disabled")]


def pick_model(models, wanted=None):
    if wanted:
        for m in models:
            if wanted.lower() in (m.id.lower(), (m.name or "").lower()):
                return m
        for m in models:
            if wanted.lower() in m.id.lower() or wanted.lower() in (m.name or "").lower():
                return m
        return None
    for word in PREFERRED:
        for m in models:
            if word in m.id.lower() or word in (m.name or "").lower():
                return m
    return models[0] if models else None


def show_models(models, current):
    for i, m in enumerate(models, 1):
        note = " (current)" if current and m.id == current.id else ""
        efforts = ", ".join(m.supported_reasoning_efforts or [])
        print("  %2d) %-28s %s%s" % (i, m.name or m.id, dim(m.id + ("; effort: " + efforts if efforts else "")), note))


async def new_session(client, model, effort):
    from copilot.generated.rpc import PermissionDecisionReject
    options = dict(model=model.id, streaming=True, available_tools=[],
                   system_message={"mode": "append", "content": SYSTEM_NOTE},
                   # No tools are offered; refuse anything that asks anyway.
                   on_permission_request=lambda request, invocation: PermissionDecisionReject(
                       feedback="This chat has no tools."))
    if effort and effort in (model.supported_reasoning_efforts or []):
        options["reasoning_effort"] = effort
    elif effort:
        print(dim("%s doesn't offer reasoning effort %r; using its default." % (model.name or model.id, effort)))
    return await client.create_session(**options)


def ask(loop, session, prompt):
    """Send one message and stream the reply. Ctrl+C stops the reply, not the chat."""
    printer = Printer()
    unsubscribe = session.on(printer.on_event)

    async def exchange():
        await session.send(prompt)
        await printer.done.wait()

    task = loop.create_task(exchange())
    try:
        loop.run_until_complete(task)
    except KeyboardInterrupt:
        task.cancel()
        loop.run_until_complete(session.abort())
        print(yellow("\n(stopped)"))
    except Exception as e:  # a dropped connection should not end the chat
        printer.error = str(e) or type(e).__name__
    finally:
        unsubscribe()
    printer.finish()


def chat(loop, a):
    run = loop.run_until_complete
    proxy = use_system_proxy()
    if proxy:
        print(dim("Using the Windows proxy %s" % proxy))
    print("Connecting to GitHub Copilot...")
    try:
        client, auth = run(sign_in())
    except Exception as e:
        sys.exit("Could not start or reach GitHub Copilot: %s\n"
                 "This needs internet access to GitHub from the command line. Behind a proxy, set HTTPS_PROXY."
                 % (str(e) or type(e).__name__))
    try:
        models = usable(run(client.list_models()))
        if not models:
            sys.exit("Your Copilot license offers no models here. Ask your Copilot administrator.")
        model = pick_model(models, a.model)
        if not model:
            print(yellow("No model matches %r. Available:" % a.model))
            show_models(models, None)
            return
        session = run(new_session(client, model, a.effort))
        print("Axis Cloud is ready: %s, signed in as %s." % (model.name or model.id, auth.login or "you"))
        print(dim("Messages go to GitHub Copilot under your work license. /models lists models, "
                  "/model N switches, /reset clears the chat, /exit quits."))
        while True:
            try:
                prompt = input("\n> ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                break
            if not prompt:
                continue
            if prompt in ("/exit", "/quit"):
                break
            if prompt == "/models":
                show_models(models, model)
                continue
            if prompt.startswith("/model"):
                wanted = prompt[len("/model"):].strip()
                choice = models[int(wanted) - 1] if wanted.isdigit() and 0 < int(wanted) <= len(models) \
                    else pick_model(models, wanted) if wanted else None
                if not choice:
                    print("Type /model and a number from /models.")
                    continue
                run(session.disconnect())
                model = choice
                session = run(new_session(client, model, a.effort))
                print("Now using %s. The chat starts afresh." % (model.name or model.id))
                continue
            if prompt == "/reset":
                run(session.disconnect())
                session = run(new_session(client, model, a.effort))
                print("Cleared.")
                continue
            if prompt == "/forget":
                print("Saved token deleted." if forget_token() else "No token was saved.")
                continue
            print()
            ask(loop, session, prompt)
    finally:
        run(client.stop())


def main():
    if os.name == "nt":
        os.system("")  # enable ANSI colours in the Windows console
    p = argparse.ArgumentParser(description="Chat with the models in your GitHub Copilot license.")
    p.add_argument("--model", help="model id or name, for example gpt-6.1-sol (default: a Sol model if offered)")
    p.add_argument("--effort", choices=["low", "medium", "high", "xhigh", "max"],
                   help="reasoning effort, for models that support it")
    p.add_argument("--debug", action="store_true", help="show the SDK's own error details")
    a = p.parse_args()
    if not a.debug:
        logging.getLogger("copilot").setLevel(logging.CRITICAL)  # we report failures ourselves
    need_sdk()
    loop = asyncio.new_event_loop()
    try:
        chat(loop, a)
    except KeyboardInterrupt:
        print()
    finally:
        loop.close()


if __name__ == "__main__":
    main()
