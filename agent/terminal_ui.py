"""Compact terminal presentation for Axis; standard library, Python 3.8+.

Keeps normal console scrollback. Windows Console, Windows Terminal, redirected
output and NO_COLOR all use the same interface with graceful fallbacks.
"""
from contextlib import contextmanager
import json
import os
import re
import shutil
import sys
import threading
import time
import unicodedata


AXIS_LOGO = (
    r"    _    __  __ ___ ____",
    r"   / \   \ \/ /|_ _/ ___|",
    "  / _ \\   \\  /  | |\\___ \\",
    r" / ___ \  /  \  | | ___) |",
    r"/_/   \_\/_/\_\|___|____/",
)


_ANSI = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-_]", re.S)
_TONES = {"accent": "36", "info": "36", "dim": "90", "warning": "33", "error": "31", "success": "32"}
_TITLES = {"inspect_computer": "Inspect computer", "find_packages": "Find packages",
           "deploy_package": "Deploy package", "it_job_status": "Deployment status",
           "computer_action": "Computer action", "directory_lookup": "Directory lookup",
           "open_remote_tool": "Remote support", "run_command": "PowerShell command",
           "list_dir": "List folder", "read_file": "Read file", "write_file": "Write file",
           "search_notes": "Search notes", "read_note": "Read note", "read_tool_output": "Read saved output",
           "web_search": "Search web", "web_read": "Read web page"}
_STATES = {"queued": "QUEUED", "running": "RUNNING", "complete": "FINISHED",
           "failed": "FAILED", "unknown": "UNKNOWN", "declined": "DECLINED",
           "copied": "COPIED", "script_succeeded": "SCRIPT EXIT 0", "reboot_required": "REBOOT REQUIRED",
           "reboot_verified": "REBOOT VERIFIED", "opened": "OPENED"}


def clean_text(value, reveal_controls=False):
    """Do not let model/file/command output send terminal control instructions.

    Approval text reveals controls instead of hiding them, so a suspicious
    command remains inspectable without executing its escape sequences.
    """
    text = str(value)
    if not reveal_controls:
        text = _ANSI.sub("", text)
    out = []
    for char in text:
        if char in "\n\t":
            out.append(char)
        elif unicodedata.category(char) in ("Cc", "Cf", "Cs"):
            if reveal_controls:
                code = ord(char)
                out.append({"\r": r"\r", "\b": r"\b", "\x1b": r"\x1b"}.get(char,
                           "\\x%02x" % code if code <= 255 else "\\u%04x" % code))
        else:
            out.append(char)
    return "".join(out)


def _width(text):
    return sum(0 if unicodedata.combining(c) else 2 if unicodedata.east_asian_width(c) in ("F", "W") else 1
               for c in text)


def _take(text, width):
    used = 0
    for i, char in enumerate(text):
        count = 0 if unicodedata.combining(char) else 2 if unicodedata.east_asian_width(char) in ("F", "W") else 1
        if used + count > width:
            return i
        used += count
    return len(text)


def _wrap(text, width):
    width = max(1, width)
    rows = []
    for line in text.expandtabs(4).split("\n"):
        while _width(line) > width:
            end = max(1, _take(line, width))
            space = line.rfind(" ", 0, end + 1)
            if space > end // 3:
                end = space
            rows.append(line[:end].rstrip())
            line = line[end:].lstrip()
        rows.append(line)
    return rows


def _enable_vt(stream):
    if os.name != "nt":
        return True
    try:
        import ctypes
        import msvcrt
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.GetConsoleMode.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
        kernel.SetConsoleMode.argtypes = (wintypes.HANDLE, wintypes.DWORD)
        mode = wintypes.DWORD()
        handle = msvcrt.get_osfhandle(stream.fileno())
        return bool(kernel.GetConsoleMode(handle, ctypes.byref(mode)) and
                    kernel.SetConsoleMode(handle, mode.value | 0x0004))
    except (AttributeError, OSError, ValueError, ImportError):
        return False


class _Activity:
    def __init__(self):
        self.stop = threading.Event()
        self.thread = None
        self.length = 0


class TerminalUI:
    def __init__(self, stream=None, plain=False, verbose=False, width=None, input_fn=None):
        self.stream = stream if stream is not None else sys.stdout
        self.plain = bool(plain)
        self.verbose = bool(verbose)
        self._fixed_width = width
        self._input_fn = input_fn
        self.interactive = bool(getattr(self.stream, "isatty", lambda: False)())
        self._vt = _enable_vt(self.stream) if self.interactive else False
        self.color = self.interactive and self._vt and not self.plain and "NO_COLOR" not in os.environ and os.environ.get("TERM") != "dumb"
        encoding = getattr(self.stream, "encoding", None) or "utf-8"
        try:
            "\u256d\u2500\u2502\u2026".encode(encoding)
            self.unicode = not self.plain
        except (UnicodeEncodeError, LookupError):
            self.unicode = False
        self._lock = threading.RLock()
        self._activity = None
        self._response_open = False
        self._thinking_open = False
        self._response_bold = False
        self._pending_star = ""

    @property
    def width(self):
        available = self._fixed_width if self._fixed_width is not None else shutil.get_terminal_size((90, 25)).columns
        return max(20, min(110, int(available)))

    def _style(self, text, tone=None, bold=False):
        if not self.color:
            return text
        codes = []
        if bold:
            codes.append("1")
        if tone:
            codes.append(_TONES.get(tone, "36"))
        return ("\033[" + ";".join(codes) + "m" + text + "\033[0m") if codes else text

    def _raw(self, text):
        try:
            self.stream.write(text)
        except UnicodeEncodeError:
            encoding = getattr(self.stream, "encoding", None) or "ascii"
            self.stream.write(text.encode(encoding, "replace").decode(encoding))
        self.stream.flush()

    def _stop_activity(self, activity=None):
        with self._lock:
            active = self._activity
            if active is None or (activity is not None and active is not activity):
                return
            self._activity = None
            active.stop.set()
        if active.thread is not threading.current_thread():
            active.thread.join()
        with self._lock:
            if active.length:
                self._raw("\r" + " " * active.length + "\r")

    def _prepare(self, close_streams=True):
        self._stop_activity()
        if close_streams:
            self.end_thinking()
            self.end_response()

    def _line(self, value="", tone=None, prefix="", bold=False):
        text = clean_text(value)
        for line in _wrap(text, self.width - _width(prefix)):
            self._raw(prefix + self._style(line, tone, bold) + "\n")

    def _heading(self, label, detail="", tone="accent"):
        label = clean_text(label)
        if self.plain:
            self._line("[" + label + "]" + ((" " + clean_text(detail)) if detail else ""), tone, bold=True)
        else:
            dash = "\u2500" if self.unicode else "-"
            line = label + (("  " + clean_text(detail)) if detail else "")
            remain = max(0, self.width - _width(line) - 3)
            self._line(dash + " " + line + " " + dash * remain, tone, bold=True)

    def _box(self, title, rows, tone="accent"):
        if self.plain:
            self._heading(title, tone=tone)
            for row in rows:
                self._line(row, prefix="  ")
            return
        tl, tr, bl, br, h, v = ("\u256d", "\u256e", "\u2570", "\u256f", "\u2500", "\u2502") if self.unicode else ("+", "+", "+", "+", "-", "|")
        body_width = self.width - 4
        title = clean_text(title)
        title = title[:max(1, body_width)]
        top = tl + h + " " + title + " "
        self._raw(self._style(top + h * max(0, self.width - _width(top) - 1) + tr, tone, True) + "\n")
        for value in rows:
            for line in _wrap(clean_text(value), body_width):
                self._raw(self._style(v, tone) + " " + line + " " * max(0, body_width - _width(line)) + " " + self._style(v, tone) + "\n")
        self._raw(self._style(bl + h * (self.width - 2) + br, tone) + "\n")

    def banner(self, model, workdir, ctx, thinking, auto_approve, package_repo=None):
        self._prepare()
        with self._lock:
            if not self.plain and self.width >= max(map(len, AXIS_LOGO)) + 4:
                self._line()
                for row in AXIS_LOGO:
                    self._line(row, "accent", prefix="  ", bold=True)
                self._line()
            details = [str(model), "Context %s  |  Thinking %s  |  Approval %s" % (
                format(ctx, ","), "on" if thinking else "off", "automatic (--yes)" if auto_approve else "ask before changes"),
                "Workspace  " + str(workdir)]
            if package_repo:
                details.append("Packages   " + str(package_repo))
            self._box("AXIS", details)
            self._line("/help commands   /jobs deployments   /paste multiline", "dim")

    def notice(self, message, tone="info"):
        self._prepare()
        with self._lock:
            self._line(message, tone, prefix="  ")

    def error(self, message):
        self._prepare()
        with self._lock:
            self._heading("ERROR", tone="error")
            self._line(message, prefix="  ")

    def help(self):
        self._prepare()
        with self._lock:
            self._heading("COMMANDS")
            for command, description in (
                ("/help", "Show these commands"), ("/status", "Model, workspace and session settings"),
                ("/jobs [ID]", "Deployment/reboot jobs or a job's details"),
                ("/output [ID] [offset]", "Read saved tool output in pages"),
                ("/history", "Recent requests from this session"),
                ("/paste", "Enter multiple lines; a single . line submits"),
                ("/reset", "Clear conversation; background jobs continue"),
                ("/clear", "Clear the display"), ("/exit", "Exit the chat; background jobs continue")):
                self._line(command + "  " + description, prefix="  ")
            self._line("Ctrl+C cancels the current request. /exit exits the chat.", "dim", prefix="  ")

    def prompt(self):
        self._prepare()
        with self._lock:
            self._raw("\n" + self._style("You", "accent", True) + self._style(" > ", "dim"))
        return (self._input_fn or input)("")

    def confirm(self, action):
        self._prepare()
        with self._lock:
            self._box("APPROVAL REQUIRED", _wrap(clean_text(action, reveal_controls=True), self.width - 4), "warning")
            question = "Allow this action? [y/N] " if self.width >= 26 else "Allow? [y/N] "
            self._raw(self._style(question, "warning", True))
        try:
            answer = (self._input_fn or input)("")
        except EOFError:
            return False
        return answer.strip().lower() in ("y", "yes")

    def assistant(self, text):
        self.begin_response()
        self.write_response(text)
        self.end_response()

    def begin_response(self):
        self._stop_activity()
        self.end_thinking()
        with self._lock:
            if not self._response_open:
                self._line()
                self._heading("AXIS")
                self._response_open = True
                self._response_bold = False
                self._pending_star = ""

    def write_response(self, text):
        if not text:
            return
        self.begin_response()
        with self._lock:
            value = self._pending_star + clean_text(text)
            self._pending_star = ""
            if value.endswith("*") and not value.endswith("**"):
                value, self._pending_star = value[:-1], "*"
            parts = value.split("**")
            for i, part in enumerate(parts):
                if i:
                    self._response_bold = not self._response_bold
                if part:
                    self._raw(self._style(part, bold=self._response_bold))

    def end_response(self):
        self._stop_activity()
        with self._lock:
            if self._response_open:
                if self._pending_star:
                    self._raw(self._pending_star)
                self._raw("\n")
                self._response_open = False
                self._response_bold = False
                self._pending_star = ""

    def begin_thinking(self):
        self._stop_activity()
        self.end_response()
        with self._lock:
            if not self._thinking_open:
                self._raw(self._style("  Thinking" + ("\n" if self.verbose else "..."), "dim"))
                self._thinking_open = True

    def write_thinking(self, text):
        if not self._thinking_open:
            self.begin_thinking()
        if self.verbose:
            with self._lock:
                self._raw(self._style(clean_text(text), "dim"))

    def end_thinking(self):
        self._stop_activity()
        with self._lock:
            if self._thinking_open:
                self._raw("\n")
                self._thinking_open = False

    @contextmanager
    def status(self, message):
        self._prepare()
        if not self.interactive or not self._vt or self.plain or os.environ.get("TERM") == "dumb":
            yield self
            return
        activity = _Activity()
        label = clean_text(message).replace("\n", " ")
        started = time.monotonic()

        def animate():
            tick = 0
            while not activity.stop.is_set():
                value = "  %s %s  %.1fs" % ("|/-\\"[tick % 4], label, time.monotonic() - started)
                value = value[:max(1, self.width - 1)]
                with self._lock:
                    if activity.stop.is_set():
                        break
                    self._raw("\r" + self._style(value, "dim") + " " * max(0, activity.length - _width(value)))
                    activity.length = _width(value)
                tick += 1
                activity.stop.wait(0.1)

        activity.thread = threading.Thread(target=animate, name="local-agent-status", daemon=True)
        with self._lock:
            self._activity = activity
        activity.thread.start()
        try:
            yield self
        finally:
            self._stop_activity(activity)

    def tool_start(self, name, args):
        self._prepare()
        with self._lock:
            self._heading(_TITLES.get(name, clean_text(name).replace("_", " ").title()))
            if isinstance(args, dict):
                fields = []
                for key in ("computer", "computers", "view", "action", "package", "script", "name", "pid", "query", "url", "offset", "link_offset", "path", "identity", "command"):
                    if key in args:
                        value = args[key]
                        value = ", ".join(str(v) for v in value) if isinstance(value, list) else str(value)
                        fields.append(key + ": " + clean_text(value, reveal_controls=True))
                lines = _wrap("  |  ".join(fields), self.width - 4)
                for line in lines[:3]:
                    self._line(line, "dim", prefix="  ")
                if len(lines) > 3:
                    self._line("... additional arguments", "dim", prefix="  ")

    def _clip(self, value, width):
        value = clean_text(value).replace("\n", " ").expandtabs(2)
        if _width(value) <= width:
            return value + " " * (width - _width(value))
        mark = "\u2026" if self.unicode else "..."
        if width <= _width(mark):
            return "." * width
        return value[:_take(value, width - _width(mark))] + mark

    def _table(self, headers, rows, limit=10):
        headers = [clean_text(h) for h in headers]
        rows = [[clean_text("" if v is None else v) for v in row] for row in rows]
        shown = rows if self.verbose else rows[:limit]
        if not shown:
            self._line("No records.", "dim", prefix="  ")
            return
        available = self.width - 4 - (3 * (len(headers) - 1))
        minimum = [min(max(7, _width(h)), 18) for h in headers]
        sizes = [max([_width(h)] + [_width(row[i]) for row in shown]) for i, h in enumerate(headers)]
        sizes = [max(minimum[i], min(size, 36)) for i, size in enumerate(sizes)]
        while sum(sizes) > available and any(sizes[i] > minimum[i] for i in range(len(sizes))):
            i = max(range(len(sizes)), key=lambda n: sizes[n] - minimum[n])
            sizes[i] -= 1
        if self.width < 56 or sum(sizes) > available:
            for row in shown:
                self._line(row[0], "accent", prefix="  ", bold=True)
                for header, value in zip(headers[1:], row[1:]):
                    self._line(header + ": " + value, self._cell_tone(header, value), prefix="    ")
        else:
            self._raw("  " + self._style("   ".join(self._clip(h, n) for h, n in zip(headers, sizes)), "dim", True) + "\n")
            for row in shown:
                self._raw("  " + "   ".join(self._style(self._clip(v, n), self._cell_tone(h, v))
                          for h, v, n in zip(headers, row, sizes)) + "\n")
        if len(shown) < len(rows):
            self._line("Showing %d of %d returned records." % (len(shown), len(rows)), "dim", prefix="  ")

    def _state(self, value):
        return _STATES.get(str(value), clean_text(value).replace("_", " ").upper())

    def _cell_tone(self, header, value):
        if header.upper() not in ("STATE", "RESULT") or not value.strip():
            return None
        state = next((key for key, label in _STATES.items() if label == value.upper()), value.lower())
        return self._tone(state)

    def _tone(self, state):
        if state in ("failed", "error"):
            return "error"
        if state in ("unknown", "reboot_required", "declined"):
            return "warning"
        if state in ("copied", "reboot_verified"):
            return "success"
        return "info"

    def tool_result(self, name, result, elapsed, output_id=None):
        self._prepare()
        with self._lock:
            text = str(result)
            try:
                data = json.loads(text)
            except (ValueError, TypeError):
                data = None
            if isinstance(data, dict) and name == "web_search":
                self._web_search_body(data)
            elif isinstance(data, dict) and name == "web_read":
                self._web_read_body(data)
            elif isinstance(data, dict) and ("jobs" in data or (name == "it_job_status" and "id" in data)):
                self._jobs_body(data)
            elif isinstance(data, dict):
                self._result_body(data)
            else:
                lines = _wrap(clean_text(text), self.width - 4)
                for line in lines if self.verbose else lines[:8]:
                    self._line(line, "error" if text.startswith("Error:") else None, prefix="  ")
                if not self.verbose and len(lines) > 8:
                    self._line("... additional output saved", "dim", prefix="  ")
            footer = "%.1fs" % max(0, elapsed)
            if output_id:
                footer += "  |  /output " + clean_text(output_id)
            self._line(footer, "dim", prefix="  ")

    def _web_search_body(self, data):
        if data.get("error"):
            self._line(data["error"], "error", prefix="  ")
            return
        if data.get("query"):
            self._line("Search  " + str(data["query"]), prefix="  ")
        if data.get("provider"):
            self._line("Provider  " + str(data["provider"]), "dim", prefix="  ")
        results = data.get("results") or []
        if not results:
            self._line("No search results returned.", "dim", prefix="  ")
        for number, result in enumerate(results, 1):
            self._line("%d. %s" % (number, result.get("title") or result.get("url") or "Untitled result"), "accent", prefix="  ", bold=True)
            if result.get("url"):
                self._line(result["url"], "dim", prefix="    ")
            if result.get("snippet"):
                self._line(result["snippet"], prefix="    ")

    def _web_read_body(self, data):
        if data.get("error"):
            self._line(data["error"], "error", prefix="  ")
            return
        if data.get("title"):
            self._line(data["title"], "accent", prefix="  ", bold=True)
        if data.get("url"):
            self._line("Source  " + str(data["url"]), "dim", prefix="  ")
        if data.get("fetched_at"):
            self._line("Fetched  " + str(data["fetched_at"]), "dim", prefix="  ")
        text = str(data.get("text") or "")
        lines = _wrap(clean_text(text), self.width - 4) if text else []
        for line in lines if self.verbose else lines[:14]:
            self._line(line, prefix="  ")
        if not lines:
            self._line("No readable page text returned.", "dim", prefix="  ")
        elif not self.verbose and len(lines) > 14:
            self._line("... additional returned text is in the saved output", "dim", prefix="  ")
        offset = data.get("offset", 0)
        pagination = "Text offset %s" % offset
        if data.get("total_characters") is not None:
            pagination += "  |  %s total characters" % data["total_characters"]
        if data.get("next_offset") is not None:
            pagination += "  |  next offset %s" % data["next_offset"]
        self._line(pagination, "dim", prefix="  ")
        links = data.get("links") or []
        if links:
            label = "Page links (%d" % len(links)
            if data.get("total_links") is not None:
                label += " returned / %s total" % data["total_links"]
            self._line(label + ")", "dim", prefix="  ")
            for number, link in enumerate(links if self.verbose else links[:8], 1):
                self._line("%s. %s" % (link.get("id", number), link.get("text") or link.get("url") or "Untitled link"), prefix="    ")
                if link.get("url"):
                    self._line(link["url"], "dim", prefix="      ")
            if not self.verbose and len(links) > 8:
                self._line("... %d more links in the saved output" % (len(links) - 8), "dim", prefix="    ")
        if data.get("next_link_offset") is not None:
            self._line("More page links: next link offset %s" % data["next_link_offset"], "dim", prefix="  ")

    def _result_body(self, data):
        state = data.get("state")
        if state:
            self._line(self._state(state), self._tone(state), prefix="  ", bold=True)
        if data.get("job_id"):
            self._line("Job " + str(data["job_id"]) + "  /jobs " + str(data["job_id"]), prefix="  ")
        if data.get("message"):
            self._line(data["message"], prefix="  ")
        if data.get("error"):
            self._line(data["error"], "error", prefix="  ")
        if "verified" in data:
            self._line("State verified" if data["verified"] is True else "State not verified", "success" if data["verified"] is True else "warning", prefix="  ")
        if isinstance(data.get("after"), dict):
            self._key_values(data["after"])
        elif isinstance(data.get("data"), dict):
            self._key_values(data["data"])
        if isinstance(data.get("items"), list):
            self._items(data["items"])
            if data.get("total") is not None:
                self._line("%d returned / %s total%s" % (len(data["items"]), data["total"],
                           "  |  next offset %s" % data["next_offset"] if data.get("next_offset") is not None else ""), "dim", prefix="  ")
        for key in ("packages", "scripts", "groups", "members"):
            if isinstance(data.get(key), list):
                values = data[key]
                self._line(key.title() + " (%d)" % len(values), "dim", prefix="  ")
                for value in values if self.verbose else values[:10]:
                    self._line(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False), prefix="    ")
                if not self.verbose and len(values) > 10:
                    self._line("... %d more" % (len(values) - 10), "dim", prefix="    ")
        if data.get("scope"):
            self._line(data["scope"], "dim", prefix="  ")
        for warning in data.get("warnings", []) if isinstance(data.get("warnings"), list) else []:
            self._line(warning, "warning", prefix="  ")
        if not any(k in data for k in ("state", "message", "error", "data", "items", "packages", "scripts", "groups", "members", "after", "verified")):
            self._key_values(data)

    def _items(self, rows):
        if not rows:
            self._line("No matching records.", "dim", prefix="  ")
            return
        if not isinstance(rows[0], dict):
            self._table(["Value"], [[v] for v in rows])
            return
        candidates = (["ProcessId", "Name", "MemoryMB"] if "CreationDate" in rows[0] else
                      ["Name", "State", "StartMode"] if "StartMode" in rows[0] else
                      ["DeviceID", "FreeGB", "SizeGB"] if "DeviceID" in rows[0] else
                      ["Name", "Version", "Publisher"] if "Version" in rows[0] else list(rows[0])[:4])
        headers = [key for key in candidates if key in rows[0]]
        if not headers:
            self._line("No displayable fields; inspect the saved output.", "dim", prefix="  ")
            return
        self._table(headers, [[row.get(h, "") if isinstance(row, dict) else row for h in headers] for row in rows])

    def _key_values(self, values):
        for key, value in values.items():
            if key == "ok" or value is None:
                continue
            if isinstance(value, (dict, list)):
                value = json.dumps(value, ensure_ascii=False)
            self._line(str(key) + "  " + str(value), prefix="  ")

    def _jobs_body(self, data):
        if "jobs" in data:
            rows = data.get("jobs") or []
            self._table(["JOB", "TARGETS", "TYPE", "STATE"], [
                [str(j.get("id", ""))[:12], ", ".join(j.get("computers") or []), j.get("kind", ""), self._state(j.get("state", "unknown"))]
                for j in rows])
            if rows:
                self._line("/jobs <ID> shows per-PC outcomes. FINISHED is a job state, not application verification.", "dim", prefix="  ")
            return
        state = data.get("state", "unknown")
        self._line("%s  %s" % (self._state(state), data.get("id", data.get("job_id", ""))), self._tone(state), prefix="  ", bold=True)
        for key in ("package", "action", "script"):
            if data.get(key):
                self._line(key.title() + "  " + str(data[key]), prefix="  ")
        if data.get("computers"):
            self._line("Targets  " + ", ".join(str(pc) for pc in data["computers"]), prefix="  ")
        results = data.get("results") or []
        if results:
            self._table(["COMPUTER", "RESULT", "EXIT"], [[r.get("computer", ""), self._state(r.get("state", "unknown")), r.get("exit_code", "")] for r in results])
        else:
            self._line("Waiting for per-PC results." if state in ("queued", "running") else "No per-PC results were recorded.", "dim", prefix="  ")
        for row in results:
            if row.get("message"):
                self._line(str(row.get("computer", "")) + ": " + str(row["message"]), self._tone(row.get("state")), prefix="  ")
            if row.get("remote_log") and (self.verbose or row.get("state") in ("failed", "unknown", "reboot_required")):
                self._line(str(row.get("computer", "")) + " installer log  " + str(row["remote_log"]), "dim", prefix="  ")
        if data.get("error"):
            self._line(data["error"], "error", prefix="  ")
        events = data.get("events") or []
        for event in events if self.verbose else events[-3:]:
            self._line("%s  %s" % (event.get("computer", ""), event.get("message", "")), "dim", prefix="  ")
        note = data.get("verification_note")
        if note or data.get("kind") == "deploy" or any(r.get("application_verified") is False for r in results):
            self._line(note or "Installer exit codes describe script execution. Application health is not verified.", "warning", prefix="  ")
        if state == "unknown":
            self._line("Inspect the target before retrying; remote work may still be running.", "warning", prefix="  ")
        if data.get("log_file"):
            self._line("Worker log  " + str(data["log_file"]), "dim", prefix="  ")

    def jobs(self, data):
        self._prepare()
        with self._lock:
            self._heading("JOBS")
            self._jobs_body(data)

    def config(self, data):
        self._prepare()
        with self._lock:
            self._heading("SESSION")
            self._key_values(data)

    def output(self, text, title="Output"):
        self._prepare()
        with self._lock:
            self._heading(clean_text(title).upper())
            self._line(text, prefix="  ")

    def metrics(self, text):
        if not text:
            return
        self._prepare()
        with self._lock:
            self._line(text, "dim", prefix="  ")

    def clear(self):
        self._prepare()
        if not self.interactive or self.plain:
            return
        with self._lock:
            self._raw("\033[2J\033[H" if self.color else "\n" * min(30, shutil.get_terminal_size((90, 25)).lines))
