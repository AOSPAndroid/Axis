"""Presentation tests use in-memory streams; no Windows targets or model needed."""
import io
import json
import os
from pathlib import Path
import sys
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from terminal_ui import TerminalUI, clean_text


class TTYStream(io.StringIO):
    def isatty(self):
        return True


class AsciiStream(io.StringIO):
    @property
    def encoding(self):
        return "ascii"


class TerminalUITests(unittest.TestCase):
    def test_plain_and_no_color_output_contains_no_ansi(self):
        for plain, environment in ((True, {}), (False, {"NO_COLOR": "1"})):
            stream = TTYStream()
            with patch.dict(os.environ, environment, clear=True), patch("terminal_ui._enable_vt", return_value=True):
                ui = TerminalUI(stream=stream, plain=plain, width=72)
                ui.banner("Qwen", r"C:\Work", 16384, False, False)
                ui.assistant("Hello **world**.")
                ui.notice("Ready")
            self.assertNotIn("\x1b", stream.getvalue())
            self.assertIn("Qwen", stream.getvalue())

    def test_controls_and_bidi_cannot_change_the_terminal(self):
        dirty = "first\x1b[2J\x1b]0;hidden title\x07last\r\b\u202eevil"
        self.assertEqual(clean_text(dirty), "firstlastevil")
        stream = io.StringIO()
        ui = TerminalUI(stream=stream, input_fn=lambda _: "n", plain=True, width=50)
        ui.confirm("run " + dirty)
        shown = stream.getvalue()
        self.assertNotIn("\x1b", shown)
        self.assertNotIn("\r", shown)
        self.assertNotIn("\u202e", shown)
        self.assertIn(r"\x1b[2J", shown)
        self.assertIn(r"\u202e", shown)

    def test_approval_is_complete_wrapped_and_defaults_to_no(self):
        action = "deploy " + "long-package-name-" * 12 + " on PC-123 final-evidence"
        for answer, expected in (("", False), ("no", False), ("yes", True), ("Y", True)):
            stream = io.StringIO()
            ui = TerminalUI(stream=stream, plain=True, width=36, input_fn=lambda _, a=answer: a)
            self.assertEqual(ui.confirm(action), expected)
            self.assertIn("final-evidence", stream.getvalue())
            self.assertTrue(all(len(line) <= 36 for line in stream.getvalue().splitlines()))
            self.assertIn("[y/N]", stream.getvalue())

    def test_streamed_bold_markers_split_between_chunks(self):
        stream = io.StringIO()
        ui = TerminalUI(stream=stream, plain=True)
        for piece in ("Hello *", "*world", "*", "* and *", "single"):
            ui.write_response(piece)
        ui.end_response()
        self.assertIn("Hello world and *single", stream.getvalue())
        self.assertEqual(stream.getvalue().count("[ASSISTANT]"), 1)
        self.assertNotIn("**", stream.getvalue())

    def test_reasoning_is_compact_unless_verbose(self):
        for verbose in (False, True):
            stream = io.StringIO()
            ui = TerminalUI(stream=stream, plain=True, verbose=verbose)
            ui.write_thinking("Detailed external model reasoning")
            ui.end_thinking()
            self.assertIn("Thinking", stream.getvalue())
            self.assertEqual("Detailed external model reasoning" in stream.getvalue(), verbose)

    def test_job_state_never_implies_verified_installation(self):
        stream = io.StringIO()
        ui = TerminalUI(stream=stream, plain=True, width=90)
        ui.tool_result("deploy_package", json.dumps({"job_id": "a" * 32, "state": "queued", "message": "Accepted; check job status"}), 0.2)
        ui.jobs({"id": "a" * 32, "kind": "deploy", "state": "complete", "results": [
            {"computer": "PC-1", "state": "script_succeeded", "exit_code": 0, "application_verified": False},
            {"computer": "PC-2", "state": "reboot_required", "exit_code": 3010, "application_verified": False},
            {"computer": "PC-3", "state": "unknown", "message": "Monitoring lost"}]})
        text = stream.getvalue()
        for required in ("QUEUED", "FINISHED", "SCRIPT EXIT 0", "REBOOT REQUIRED", "UNKNOWN", "PC-1", "PC-2", "PC-3", "Application health is not verified"):
            self.assertIn(required, text)
        self.assertNotIn("installation verified", text.lower())

    def test_narrow_and_ascii_only_terminals(self):
        stream = AsciiStream()
        ui = TerminalUI(stream=stream, width=30)
        ui.banner("A model", r"C:\very\long\workspace\folder", 16384, True, True, r"C:\long\package\repository")
        ui.jobs({"jobs": [{"id": "a" * 32, "computers": ["PC-123", "PC-456"], "kind": "deploy", "state": "unknown"}]})
        self.assertTrue(stream.getvalue().isascii())
        self.assertTrue(all(len(line) <= 30 for line in stream.getvalue().splitlines()))
        self.assertIn("UNKNOWN", stream.getvalue())

    def test_noninteractive_status_is_silent(self):
        stream = io.StringIO()
        ui = TerminalUI(stream=stream)
        with ui.status("Waiting"):
            pass
        self.assertEqual(stream.getvalue(), "")

    def test_spinner_does_not_run_without_terminal_support(self):
        stream = TTYStream()
        with patch("terminal_ui._enable_vt", return_value=False):
            ui = TerminalUI(stream=stream)
        with ui.status("Waiting"):
            self.assertIsNone(ui._activity)
        self.assertEqual(stream.getvalue(), "")

    def test_semantic_result_colors_and_failure_log_locations(self):
        stream = TTYStream()
        with patch.dict(os.environ, {}, clear=True), patch("terminal_ui._enable_vt", return_value=True):
            ui = TerminalUI(stream=stream, width=100)
        ui.jobs({"id": "a" * 32, "kind": "deploy", "state": "unknown", "results": [
            {"computer": "PC-1", "state": "failed", "remote_log": r"C:\Temp\LocalAgent\Jobs\abc\output.log"},
            {"computer": "PC-2", "state": "unknown"}, {"computer": "PC-3", "state": "copied"},
            {"computer": "PC-4", "state": "script_succeeded", "application_verified": False}]})
        text = stream.getvalue()
        self.assertIn("\x1b[31mFAILED", text)
        self.assertIn("\x1b[33mUNKNOWN", text)
        self.assertIn("\x1b[32mCOPIED", text)
        self.assertIn("\x1b[36mSCRIPT EXIT 0", text)
        self.assertIn("PC-1 installer log", text)
        self.assertIn(r"C:\Temp\LocalAgent\Jobs\abc\output.log", text)

    def test_empty_item_record_is_rendered_gracefully(self):
        stream = io.StringIO()
        ui = TerminalUI(stream=stream, plain=True)
        ui.tool_result("inspect_computer", '{"items":[{}]}', 0.1)
        self.assertIn("No displayable fields", stream.getvalue())

    def test_minimum_width_approval_and_queued_job_remain_readable(self):
        stream = io.StringIO()
        ui = TerminalUI(stream=stream, plain=True, width=20, input_fn=lambda _: "")
        self.assertFalse(ui.confirm("restart PC-123"))
        ui.jobs({"id": "a" * 32, "state": "queued", "computers": ["PC-123"], "results": []})
        self.assertTrue(all(len(line) <= 20 for line in stream.getvalue().splitlines()))
        self.assertIn("PC-123", stream.getvalue())
        self.assertIn("Waiting for per-PC", stream.getvalue())

    def test_spinner_joins_before_approval_and_on_exception(self):
        stream = TTYStream()
        seen = []
        with patch("terminal_ui._enable_vt", return_value=True):
            ui = TerminalUI(stream=stream, input_fn=lambda _: seen.append(ui._activity) or "n")
        with ui.status("Working"):
            time.sleep(0.12)
            ui.confirm("restart PC-1")
        self.assertEqual(seen, [None])
        self.assertIsNone(ui._activity)
        try:
            with ui.status("More work"):
                raise ValueError("test")
        except ValueError:
            pass
        self.assertIsNone(ui._activity)
        self.assertFalse(any(t.name == "local-agent-status" for t in threading.enumerate()))


if __name__ == "__main__":
    unittest.main()
