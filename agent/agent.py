#!/usr/bin/env python3
"""Axis: a local assistant for an OpenAI-compatible server (llama-server or LM Studio).

Python 3.8+ standard library only. Usage:
    python agent.py                      # interactive
    python agent.py "summarise notes.txt" # one task, then exit
"""
import argparse
import base64
import datetime
import html
import http.client
import json
import os
import platform
import re
import subprocess
import sys
import threading
import urllib.error
import urllib.request
import uuid

MAX_TOOL_OUTPUT = 3000   # chars of tool output sent back to the model (start and end kept)
MAX_STEPS = 15           # tool calls per task before giving up

SYSTEM_PROMPT = """You are Axis, a helpful assistant running locally on the user's Windows computer. You chat, answer questions, explain, write and translate like any assistant. You can also use tools to work with files and run PowerShell commands on this computer and on other computers by name.

## When to use tools
- Only when the request needs them: information from a computer or file, or an action. For greetings, tests, general questions, writing or explanations, just answer without running anything.
- If the request is unclear, ask a short question instead of guessing.
- Never invent facts about computers, people, files or settings. Get them with a tool, or say you don't know. When you report results, use the real values from the output.
- Before guessing names, paths, procedures or how something is done here, search your notes with search_notes.

## This computer
{facts}
Working directory for the file tools: {workdir}

## Your notes
{notes}

## IT work
1. Read the current state before changing anything. Before a change, say in one line what and why; make one change at a time, then read the state again to verify it. Never claim success without checking. A non-zero exit code or ReturnValue means it failed: report it as a failure with the code, never as success.
2. Commands must be non-interactive, with short output: Select-Object only the needed properties, -First or -MaxEvents, Format-Table -AutoSize.
3. Never guess computer names, services, paths or accounts; look them up. Ask before any change on another computer, and before anything risky: deleting data, registry edits, reboots, security software, accounts, groups or permissions.
4. This session is {elevation}; on other computers your account's rights apply. If access is denied, say so instead of working around it.
5. End with a short summary: what you found, changed and verified.

## Command style (as in the Atlas IT tool)
- Check a computer answers: Test-Connection -ComputerName PC -Count 1 -Quiet
- Read with WMI: Get-WmiObject -ComputerName PC -Class Win32_X -ErrorAction Stop. Classes: Win32_OperatingSystem (version, memory, LastBootUpTime), Win32_ComputerSystem (model, logged-on UserName), Win32_LogicalDisk -Filter "DriveType=3", Win32_Service, Win32_Process.
- Services: $s = Get-WmiObject -ComputerName PC -Class Win32_Service -Filter "Name='X'"; $s.StartService() or $s.StopService(); ReturnValue 0 means accepted; then read State again. Never stop RpcSs, DcomLaunch, RpcEptMapper, Winmgmt, WinRM, LanmanServer or EventLog. Do not change startup types unless asked.
- Processes: re-read by ProcessId right before $p.Terminate(). Never end System, smss, csrss, wininit, services, lsass or winlogon.
- Remote task: Invoke-WmiMethod -ComputerName PC -Class Win32_Process -Name Create -ArgumentList 'cmd.exe /c ...'
- Active Directory, read-only unless asked: Import-Module ActiveDirectory; Get-ADUser, Get-ADComputer or Get-ADGroup -Identity name -Properties ...; stop if a search matches more than one.
- Use WMI to read other computers. PsExec is not used here.
- Restart a computer: Restart-Computer -ComputerName PC -Force (not Win32Shutdown).
"""

# Collected once at startup and put in the system prompt.
FACTS_SCRIPT = r"""
$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$admin = ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$pwsh = Get-Command pwsh
$pwshVersion = if ($pwsh) { $pwsh.Version.ToString() } else { $null }
@{ os = $os.Caption; version = $os.Version; build = $os.BuildNumber; arch = $os.OSArchitecture
   hostname = $env:COMPUTERNAME; user = $id.Name; admin = $admin
   domain = $cs.Domain; partOfDomain = $cs.PartOfDomain
   powershell = $PSVersionTable.PSVersion.ToString(); pwsh = $pwshVersion } | ConvertTo-Json -Compress
"""

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
        "description": ("Run a Windows PowerShell command in the working directory and return its output. "
                        "Non-interactive: it cannot answer prompts." if os.name == "nt" else
                        "Run a shell command (sh) in the working directory and return its output."),
        "parameters": {"type": "object", "properties": {
            "command": {"type": "string"}}, "required": ["command"]}}},
    {"type": "function", "function": {
        "name": "search_notes",
        "description": "Search the user's notes (runbooks, procedures, names, known fixes) for a word or phrase. "
                       "Returns matching lines with file name and line number.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {
        "name": "read_note",
        "description": "Read one note file from the notes folder, by the name shown in the notes list or search results.",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"}}, "required": ["name"]}}},
]

NOTE_TYPES = (".md", ".txt")
ALWAYS_NOTE = "ALWAYS.md"   # loaded into every conversation
MAX_ALWAYS = 2000           # chars of ALWAYS.md put in the prompt


class Agent:
    def __init__(self, base_url, model, workdir, auto_approve, think, ctx=8192, notes=None):
        self.base_url = base_url.rstrip("/")
        self.notes_dir = os.path.realpath(notes or os.path.join(os.path.dirname(os.path.abspath(__file__)), "notes"))
        os.makedirs(self.notes_dir, exist_ok=True)
        self.model = model
        self.workdir = os.path.realpath(workdir)
        self.auto_approve = auto_approve
        self.think = think
        # ~3.5 chars per token, leaving room for tool schemas and the reply.
        self.history_budget = int(ctx * 2.5)
        # The server is local; never route it through a system proxy.
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.stats = {}
        self.stream_lead = ""
        self.facts, self.elevated = system_facts()
        self.reset()

    def reset(self):
        system = SYSTEM_PROMPT.format(
            facts=self.facts, workdir=self.workdir, notes=self.notes_summary(),
            elevation="elevated (administrator rights)" if self.elevated else "not elevated (standard user rights)")
        self.messages = [{"role": "system", "content": system}]

    def note_files(self):
        found = []
        for base, _, files in os.walk(self.notes_dir):
            for name in files:
                if name.lower().endswith(NOTE_TYPES):
                    found.append(os.path.relpath(os.path.join(base, name), self.notes_dir))
        return sorted(found, key=str.lower)

    def read_note_text(self, rel):
        with open(os.path.join(self.notes_dir, rel), encoding="utf-8", errors="replace") as f:
            return f.read()

    def notes_summary(self):
        """Notes folder, its files with their first line, and ALWAYS.md, for the system prompt."""
        files = self.note_files()
        if not files:
            return "No notes yet. The user can add .md or .txt files to %s." % self.notes_dir
        lines = ["Folder: %s. Files:" % self.notes_dir]
        for rel in files[:40]:
            first = next((l.strip().lstrip("#").strip() for l in self.read_note_text(rel).splitlines() if l.strip()), "")
            lines.append("- %s%s" % (rel, (": " + first[:70]) if first else ""))
        if len(files) > 40:
            lines.append("- ... and %d more (use search_notes)" % (len(files) - 40))
        always = [f for f in files if f.lower() == ALWAYS_NOTE.lower()]
        if always:
            lines.append("Always remember (from %s):\n%s" % (ALWAYS_NOTE, shorten(self.read_note_text(always[0]).strip(), MAX_ALWAYS)))
        return "\n".join(lines)

    def search_notes(self, query):
        query = (query or "").strip()
        if not query:
            return "Error: empty search."
        phrase = query.lower()
        words = [w for w in re.findall(r"\w+", phrase) if len(w) >= 3] or [phrase]
        hits = []
        for rel in self.note_files():
            lines = self.read_note_text(rel).splitlines()
            for i, line in enumerate(lines):
                low = line.lower()
                score = (2 * len(words) if phrase in low else 0) + sum(w in low for w in words)
                if score:
                    hits.append((-score, rel.lower(), i, rel, lines))
        if not hits:
            return "No match in the notes for %r." % query
        out = []
        for _, _, i, rel, lines in sorted(hits)[:15]:
            context = [l.strip() for l in lines[max(0, i - 1):i + 2] if l.strip()]
            out.append("%s:%d: %s" % (rel, i + 1, " | ".join(context)))
        return "\n".join(out)

    def warm_up(self):
        """Have the server process the system prompt now, so the first answer starts sooner."""
        body = {"model": self.model, "messages": self.messages + [{"role": "user", "content": "hi"}],
                "tools": TOOLS, "max_tokens": 1}
        if not self.think:
            body["chat_template_kwargs"] = {"enable_thinking": False}
        req = urllib.request.Request(self.base_url + "/chat/completions", data=json.dumps(body).encode("utf-8"),
                                     headers={"Content-Type": "application/json"})
        try:
            self.http.open(req, timeout=600).read()
        except Exception:
            pass

    # ---- model -----------------------------------------------------------

    def chat(self):
        # Thinking mode uses Qwen's recommended sampling; otherwise stay close to the evidence.
        sampling = {"temperature": 0.6, "top_p": 0.95} if self.think else {"temperature": 0.3, "top_p": 0.9}
        body = dict({"model": self.model, "messages": self.messages, "tools": TOOLS, "top_k": 20}, **sampling)
        if not self.think:
            body["chat_template_kwargs"] = {"enable_thinking": False}
        body["stream"] = True
        req = urllib.request.Request(
            self.base_url + "/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": "Bearer local"})
        try:
            with self.http.open(req, timeout=900) as resp:
                if "text/event-stream" not in (resp.headers.get("Content-Type") or ""):
                    data = json.load(resp)  # server ignored "stream"
                    self.add_timings(data.get("timings"))
                    return dict(data["choices"][0]["message"], shown=False)
                return self.read_stream(resp)
        except urllib.error.HTTPError as e:
            raise RuntimeError("server returned %s: %s" % (e.code, e.read().decode("utf-8", "replace")[:500]))
        except urllib.error.URLError as e:
            raise RuntimeError("cannot reach %s (%s). Is llama-server running?" % (self.base_url, e.reason))
        except (OSError, http.client.HTTPException) as e:
            raise RuntimeError("connection to the server failed: %s" % e)
        except (ValueError, KeyError, IndexError):
            raise RuntimeError("unexpected response from the server")

    def add_timings(self, timings):
        for key in ("cache_n", "prompt_n", "prompt_ms", "predicted_n", "predicted_ms"):
            self.stats[key] = self.stats.get(key, 0) + ((timings or {}).get(key) or 0)

    def read_stream(self, resp):
        """Collect a streamed reply, printing visible text as it arrives."""
        live = LiveText(self.stream_lead)
        calls = {}
        reasoning_open = False
        for raw in resp:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                break
            chunk = json.loads(payload)
            if chunk.get("timings"):
                self.add_timings(chunk["timings"])
            for choice in chunk.get("choices") or []:
                delta = choice.get("delta") or {}
                if delta.get("reasoning_content"):
                    if not reasoning_open:
                        print(dim("thinking: "), end="")
                        reasoning_open = True
                    print(dim(delta["reasoning_content"]), end="", flush=True)
                elif reasoning_open and (delta.get("content") or delta.get("tool_calls")):
                    print(flush=True)
                    reasoning_open = False
                if delta.get("content"):
                    live.feed(delta["content"])
                for tc in delta.get("tool_calls") or []:
                    slot = calls.setdefault(tc.get("index", 0), {"id": "", "type": "function",
                                                                 "function": {"name": "", "arguments": ""}})
                    slot["id"] = tc.get("id") or slot["id"]
                    fn = tc.get("function") or {}
                    slot["function"]["name"] += fn.get("name") or ""
                    slot["function"]["arguments"] += fn.get("arguments") or ""
        if reasoning_open:
            print(flush=True)
        live.finish()
        message = {"role": "assistant", "content": live.text, "shown": live.shown > 0}
        if calls:
            message["tool_calls"] = [calls[i] for i in sorted(calls)]
        return message

    def speed(self):
        """One line on how long the model spent reading and writing for the last task."""
        s = self.stats
        if not s.get("predicted_ms"):
            return ""
        read = "read %d new tokens" % s["prompt_n"]
        if s.get("prompt_ms"):
            read += " at %.0f/s" % (s["prompt_n"] / (s["prompt_ms"] / 1000))
        if s.get("cache_n"):
            read += " (%d reused)" % s["cache_n"]
        write = "wrote %d at %.1f/s" % (s["predicted_n"], s["predicted_n"] / (s["predicted_ms"] / 1000))
        return "(%s; %s; model time %.0f s)" % (read, write, (s.get("prompt_ms", 0) + s["predicted_ms"]) / 1000)

    def run(self, task):
        """Work on a task; returns the final answer. answer_shown says whether it was already printed."""
        self.stats = {}
        self.answer_shown = False
        self.messages.append({"role": "user", "content": task})
        for step in range(MAX_STEPS):
            self.trim_history()
            self.stream_lead = "\n" if step else ""  # set the model's words apart from tool output
            msg = self.chat()
            content = strip_thinking(msg.get("content") or "")
            calls = msg.get("tool_calls") or []
            if not calls:
                content, calls = parse_inline_tool_calls(content)
            self.messages.append({"role": "assistant", "content": content,
                                  **({"tool_calls": calls} if calls else {})})
            if not calls:
                self.answer_shown = msg.get("shown", False)
                return content
            if content and not msg.get("shown"):
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
                                      "name": name, "content": shorten(result, MAX_TOOL_OUTPUT)})
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
            if name == "search_notes":
                return self.search_notes(args.get("query"))
            if name == "read_note":
                full = os.path.realpath(os.path.join(self.notes_dir, args["name"]))
                if os.path.commonpath([full, self.notes_dir]) != self.notes_dir or not os.path.isfile(full):
                    return "Error: no note %r. Notes: %s" % (args["name"], ", ".join(self.note_files()) or "none")
                return self.read_note_text(os.path.relpath(full, self.notes_dir))
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
                command = args["command"]
                # On Windows, read-only commands run straight away; anything else asks first.
                proc = None
                if os.name == "nt" and not self.auto_approve:
                    proc = run_shell(command, self.workdir, check_read_only=True)
                    if proc.returncode == NEEDS_APPROVAL and b"__NEEDS_APPROVAL__" in proc.stdout:
                        proc = None
                    else:
                        print(dim("(read-only: ran without asking)"))
                if proc is None:
                    if not self.confirm("run: %s" % command):
                        return "User declined to run the command."
                    proc = run_shell(command, self.workdir)
                out = (decode(proc.stdout) + decode(proc.stderr)).strip()
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


# ---- local system ----------------------------------------------------------

def powershell(script):
    """Arguments to run a PowerShell script non-interactively with UTF-8 output."""
    script = ("$ProgressPreference = 'SilentlyContinue'; "
              "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; "
              "if ($PSStyle) { $PSStyle.OutputRendering = 'PlainText' }\n" + script)
    encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    return ["powershell.exe", "-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-EncodedCommand", encoded]


# Decides whether a command only reads. Uses PowerShell's own parser, so quoting tricks
# cannot hide a command. Anything not clearly read-only needs the user's approval.
READ_ONLY_CHECK = r"""
function Test-ReadOnly([string]$src) {
  $tokens = $null; $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseInput($src, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { return $true }  # nothing runs; PowerShell reports the syntax error
  $cmdlets = @('where-object','select-object','sort-object','group-object','measure-object','compare-object',
    'foreach-object','format-table','format-list','format-wide','out-string','select-string','convertto-json',
    'convertfrom-json','convertto-csv','convertfrom-csv','test-connection','test-netconnection','test-path',
    'test-wsman','resolve-dnsname','write-output','write-host','join-path','split-path','new-timespan')
  $aliases = @{ gwmi='get-wmiobject'; gcim='get-ciminstance'; gci='get-childitem'; ls='get-childitem';
    dir='get-childitem'; cat='get-content'; type='get-content'; gc='get-content'; gsv='get-service';
    gps='get-process'; ps='get-process'; gi='get-item'; gp='get-itemproperty'; where='where-object';
    '?'='where-object'; select='select-object'; sort='sort-object'; group='group-object'; measure='measure-object';
    '%'='foreach-object'; foreach='foreach-object'; ft='format-table'; fl='format-list'; fw='format-wide';
    echo='write-output'; write='write-output'; sls='select-string'; compare='compare-object'; diff='compare-object' }
  $anyArgs = @('ping','tracert','pathping','nslookup','whoami','hostname','systeminfo','tasklist','netstat',
    'getmac','driverquery','quser')
  $methods = @('tostring','converttodatetime','round','floor','ceiling','truncate','abs','max','min','substring',
    'trim','trimstart','trimend','tolower','toupper','tolowerinvariant','toupperinvariant','split',
    'contains','startswith','endswith','indexof','join','format','padleft','padright','gettype','equals',
    'compareto','adddays','addhours','addminutes','addseconds','toshortdatestring','tolongdatestring',
    'touniversaltime','tolocaltime','parse','parseexact','gethostname','gethostaddresses','getcurrent',
    'isinrole','getenvironmentvariable','exists')
  # Static calls ([Type]::Method()) only on types without side effects.
  $types = @('math','string','datetime','timespan','convert','int','int32','int64','long','double','decimal',
    'environment','net.dns','security.principal.windowsidentity','regex','guid','io.path')
  foreach ($node in $ast.FindAll({ $true }, $true)) {
    if ($node -is [System.Management.Automation.Language.CommandAst]) {
      $name = $node.GetCommandName()
      if (-not $name -or $node.InvocationOperator -ne 'Unknown') { return $false }
      $n = $name.ToLowerInvariant()
      if ($aliases.ContainsKey($n)) { $n = $aliases[$n] }
      if ($n -eq 'foreach-object') {
        # Only script blocks: "ForEach-Object StopService" would call a method by name.
        foreach ($e in @($node.CommandElements | Select-Object -Skip 1)) {
          $isBlock = $e -is [System.Management.Automation.Language.ScriptBlockExpressionAst]
          $isParam = $e -is [System.Management.Automation.Language.CommandParameterAst] -and $e.ParameterName -in @('Process', 'Begin', 'End')
          if (-not ($isBlock -or $isParam)) { return $false }
        }
        continue
      }
      if ($n -like 'get-*' -or $cmdlets -contains $n) { continue }
      $argv = @($node.CommandElements | Select-Object -Skip 1 | ForEach-Object { $_.Extent.Text.Trim([char[]]"'`"").ToLowerInvariant() })
      if ($n -eq 'import-module' -and ($argv -join ' ') -eq 'activedirectory') { continue }
      $exe = $n -replace '\.exe$', ''
      if ($anyArgs -contains $exe) { continue }
      if ($exe -eq 'ipconfig' -and -not ($argv | Where-Object { $_ -notin @('/all', '/displaydns') })) { continue }
      if ($exe -eq 'query' -and $argv.Count -and $argv[0] -in @('user', 'session')) { continue }
      if ($n -eq 'sc.exe' -and $argv.Count -and $argv[0] -in @('query', 'queryex', 'qc', 'qdescription', 'qfailure', 'getdisplayname', 'getkeyname', 'enumdepend')) { continue }
      if ($exe -eq 'gpresult' -and -not ($argv | Where-Object { $_ -like '/h*' -or $_ -like '/x*' -or $_ -eq '/f' })) { continue }
      return $false
    }
    if ($node -is [System.Management.Automation.Language.InvokeMemberExpressionAst]) {
      if ($node.Member -isnot [System.Management.Automation.Language.StringConstantExpressionAst]) { return $false }
      $m = $node.Member.Value.ToLowerInvariant()
      if ($methods -notcontains $m) { return $false }
      if ($node.Static) {
        if ($node.Expression -isnot [System.Management.Automation.Language.TypeExpressionAst]) { return $false }
        $t = $node.Expression.TypeName.FullName.ToLowerInvariant() -replace '^system\.', ''
        $fileCheck = $t -in @('io.file', 'io.directory') -and $m -eq 'exists'
        if (-not ($types -contains $t -or $fileCheck)) { return $false }
      }
    }
    if ($node -is [System.Management.Automation.Language.FileRedirectionAst]) { return $false }
    if ($node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
        $node.Left -isnot [System.Management.Automation.Language.VariableExpressionAst]) { return $false }
  }
  return $true
}
$__readOnly = $false
try { $__readOnly = Test-ReadOnly $__src } catch { }
if (-not $__readOnly) { '__NEEDS_APPROVAL__'; exit 97 }
"""

# Formats output at a fixed width (a console-less or narrow window would cut tables)
# and keeps a meaningful exit code: the last program's, else 1 if PowerShell logged an error.
POWERSHELL_WRAPPER = """$__src = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%s'))
%s
$__errors = $Error.Count
. ([scriptblock]::Create($__src)) | Out-String -Width 250 -Stream
if ($LASTEXITCODE) { exit $LASTEXITCODE }
if ($Error.Count -gt $__errors) { exit 1 }"""
NEEDS_APPROVAL = 97


def shell_command(command, check_read_only=False):
    """Arguments to run a command. With check_read_only, PowerShell exits with NEEDS_APPROVAL
    instead of running a command that is not clearly read-only."""
    if os.name != "nt":
        return command
    source = base64.b64encode(command.encode("utf-8")).decode("ascii")
    return powershell(POWERSHELL_WRAPPER % (source, READ_ONLY_CHECK if check_read_only else ""))


def run_shell(command, cwd, check_read_only=False):
    return subprocess.run(shell_command(command, check_read_only), shell=os.name != "nt", cwd=cwd,
                          stdin=subprocess.DEVNULL, capture_output=True, timeout=300)


ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


CLIXML_RE = re.compile(r'<S S="(?:Error|Warning)">(.*?)</S>', re.S)


def clixml_to_text(text):
    """Windows PowerShell sends errors as CLIXML when it has no console; turn them back into text."""
    head, marker, xml = text.partition("#< CLIXML")
    if not marker:
        return text
    parts = [html.unescape(re.sub(r"_x([0-9A-Fa-f]{4})_", lambda m: chr(int(m.group(1), 16)), value))
             for value in CLIXML_RE.findall(xml)]
    return head + "".join(parts).replace("\r\n", "\n")


def decode(data):
    """Command output as text, without a byte-order mark, terminal colour codes or CLIXML."""
    return clixml_to_text(ANSI_RE.sub("", data.decode("utf-8", errors="replace").lstrip("\ufeff")))


def system_facts():
    """(text for the system prompt, elevated?) describing this computer."""
    today = datetime.date.today().isoformat()
    if os.name == "nt":
        try:
            out = subprocess.run(powershell(FACTS_SCRIPT), stdin=subprocess.DEVNULL,
                                 capture_output=True, timeout=30).stdout
            f = json.loads(decode(out).strip().splitlines()[-1])
            join = lambda *parts: " ".join(str(p) for p in parts if p)
            where = ("domain " if f.get("partOfDomain") else "workgroup ") + f["domain"] if f.get("domain") else ""
            lines = [("Computer", join(f.get("hostname"), "(%s)" % where if where else "")),
                     ("User", f.get("user")),
                     ("OS", join(f.get("os"), f.get("version"), "build %s" % f["build"] if f.get("build") else "", f.get("arch"))),
                     ("PowerShell", join(f.get("powershell"), "(run_command uses Windows PowerShell%s)" % (
                         "; PowerShell 7 is also installed as pwsh" if f.get("pwsh") else ""))),
                     ("Today", today)]
            return "\n".join("%s: %s" % (k, v) for k, v in lines if v), bool(f.get("admin"))
        except (OSError, subprocess.SubprocessError, ValueError, IndexError, KeyError):
            pass
    import getpass
    elevated = hasattr(os, "geteuid") and os.geteuid() == 0
    lines = ["Computer: %s" % platform.node(), "User: %s" % getpass.getuser(),
             "OS: %s" % platform.platform(),
             "Shell: %s" % ("Windows PowerShell" if os.name == "nt" else "sh"), "Today: %s" % today]
    return "\n".join(lines), elevated


# ---- model output helpers ------------------------------------------------

class LiveText:
    """Prints streamed model text, hiding <think> blocks and tool-call markup like strip_thinking does."""
    TAGS = ("<think>", "</think>", "<tool_call>", "<function=")

    def __init__(self, lead=""):
        self.text = ""
        self.shown = 0
        self.bold = False
        self.lead = lead  # printed before the first visible text, e.g. a blank line after tool output

    def visible(self, final=False):
        t = self.text
        if "</think>" in t:
            t = t.rsplit("</think>", 1)[1]
        elif "<think>" in t:
            t = t.split("<think>", 1)[0]
        for tag in ("<tool_call>", "<function="):
            if tag in t:
                t = t.split(tag, 1)[0]
        if not final:
            cut = t.rfind("<")
            if cut >= 0 and any(tag.startswith(t[cut:]) for tag in self.TAGS):
                t = t[:cut]  # wait until we know whether this is a tag
            if t.endswith("*") and not t.endswith("**"):
                t = t[:-1]   # may be the start of a ** marker
        return t.lstrip()

    def feed(self, piece):
        self.text += piece
        self.show(self.visible())

    def show(self, v):
        if len(v) > self.shown:
            if not self.shown and self.lead:
                print(self.lead, end="")
            out, self.bold = render_bold(v[self.shown:], self.bold)
            print(out, end="", flush=True)
            self.shown = len(v)

    def finish(self):
        self.show(self.visible(final=True).rstrip())
        if self.bold:
            print(render_bold("", True, close=True)[0], end="")
            self.bold = False
        if self.shown:
            print(flush=True)


def render_bold(text, bold=False, close=False):
    """Turn Markdown **bold** into terminal bold (or drop the markers). Returns (text, bold still on)."""
    parts = text.split("**")
    out = parts[0]
    for part in parts[1:]:
        bold = not bold
        if COLOR:
            out += "\033[1m" if bold else "\033[22m"
        out += part
    if close and bold:
        out += "\033[22m" if COLOR else ""
        bold = False
    return out, bold


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


def shorten(text, limit):
    """Keep the start and the end, where command errors usually are."""
    if len(text) <= limit:
        return text
    head = limit * 2 // 3
    tail = limit - head
    return "%s\n... [%d chars omitted] ...\n%s" % (text[:head], len(text) - limit, text[-tail:])


def preview_args(args):
    if not isinstance(args, dict):
        return "?"
    return ", ".join("%s=%s" % (k, '"%s"' % truncate(v, 120) if isinstance(v, str) else truncate(json.dumps(v), 60))
                     for k, v in args.items())


COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def _color(code):
    return lambda s: "\033[%sm%s\033[0m" % (code, s) if COLOR else s


dim, cyan, yellow = _color("2"), _color("36"), _color("33")


def main():
    if os.name == "nt":
        os.system("")  # enable ANSI colours in the Windows console
    p = argparse.ArgumentParser(description="Axis: a local assistant for an OpenAI-compatible server.")
    p.add_argument("task", nargs="*", help="run one task and exit")
    p.add_argument("--url", default=os.environ.get("AGENT_URL", "http://127.0.0.1:8080/v1"),
                   help="server base URL (LM Studio: http://127.0.0.1:1234/v1)")
    p.add_argument("--model", default=os.environ.get("AGENT_MODEL", "Qwen3.8-9B-Q4_K_M"))
    p.add_argument("--workdir", default=".", help="folder the agent may work in")
    p.add_argument("--yes", action="store_true", help="approve writes and commands without asking")
    p.add_argument("--ctx", type=int, default=8192, help="context size the server was started with (-c)")
    p.add_argument("--think", action="store_true", help="enable the model's thinking mode (slower; shows its reasoning)")
    p.add_argument("--notes", help="notes folder (default: the notes folder next to agent.py)")
    a = p.parse_args()

    agent = Agent(a.url, a.model, a.workdir, a.yes, a.think, a.ctx, a.notes)
    try:
        if a.task:
            answer = agent.run(" ".join(a.task))
            if not agent.answer_shown:
                print(render_bold(answer, close=True)[0])
            if agent.speed():
                print(dim(agent.speed()))
            return
        print("Axis is ready. Working folder: %s. /reset clears history, /exit quits." % agent.workdir)
        threading.Thread(target=agent.warm_up, daemon=True).start()
        while True:
            task = input("\n> ").strip()
            if task in ("/exit", "/quit"):
                break
            if task == "/reset":
                agent.reset()
                continue
            if task:
                try:
                    print()
                    answer = agent.run(task)
                    if not agent.answer_shown:
                        print(render_bold(answer, close=True)[0])
                    if agent.speed():
                        print(dim(agent.speed()))
                except RuntimeError as e:
                    print("Error: %s" % e)
    except RuntimeError as e:
        sys.exit("Error: %s" % e)
    except (KeyboardInterrupt, EOFError):
        print()


if __name__ == "__main__":
    main()
