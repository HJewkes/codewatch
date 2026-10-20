import contextlib
import importlib.util
import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent.parent / "c239" / "harness" / "gates.py"
spec = importlib.util.spec_from_file_location("gates", HARNESS)
gates = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gates)

SOURCE = '''def _flag(args, name):
    return name in args


def _once(value):
    return value.strip()


def parse(args):
    verbose = _flag(args, "-v")
    quiet = _flag(args, "-q")
    return verbose, quiet, _once(args[0])
'''


def finding(symbol):
    return {"path": "tool.py", "symbol": symbol, "signal": "symbol-single-caller-helper"}


class SingleCallerHelperTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.ws = Path(self._tmp.name)
        (self.ws / "tool.py").write_text(SOURCE)
        audit = self.ws / ".codewatch" / "audit"
        audit.mkdir(parents=True)
        rows = [finding("_flag"), finding("_once"), {"path": "tool.py", "symbol": "parse", "signal": "clone"}]
        (audit / "findings.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))

    def tearDown(self):
        self._tmp.cleanup()

    def test_helper_called_twice_inside_its_one_caller_is_reported_as_multi_site(self):
        split = gates.single_caller_helpers(self.ws)
        self.assertEqual(split, {"one_site": ["tool.py#_once"], "multi_site": ["tool.py#_flag"]})

    def test_helper_called_from_two_functions_stays_under_the_gate(self):
        (self.ws / "tool.py").write_text(SOURCE + "\n\ndef other(args):\n    return _flag(args, '-x')\n")
        self.assertIn("tool.py#_flag", gates.single_caller_helpers(self.ws)["one_site"])

    def helpers_of(self, source: str, symbol: str) -> dict:
        (self.ws / "tool.py").write_text(source)
        (self.ws / ".codewatch" / "audit" / "findings.jsonl").write_text(json.dumps(finding(symbol)) + "\n")
        return gates.single_caller_helpers(self.ws)

    def test_same_named_method_call_in_the_one_caller_does_not_make_a_helper_multi_site(self):
        source = ("def close(path):\n    return path\n\n\nclass Runner:\n    def run(self, f):\n"
                  "        f.close()\n        return close(f.name)\n")
        self.assertEqual(self.helpers_of(source, "close"), {"one_site": ["tool.py#close"], "multi_site": []})

    def test_method_helper_called_twice_through_self_in_its_one_caller_is_multi_site(self):
        source = ("class Runner:\n    def _timeout(self, x):\n        return x\n\n"
                  "    def run(self, a, b):\n        return self._timeout(a), self._timeout(b)\n")
        self.assertEqual(self.helpers_of(source, "Runner._timeout")["multi_site"], ["tool.py#Runner._timeout"])

    def test_self_calls_from_another_class_do_not_count_for_a_method(self):
        source = ("class Runner:\n    def _timeout(self, x):\n        return x\n\n    def run(self, a):\n"
                  "        return self._timeout(a)\n\n\nclass Other:\n    def go(self, a, b):\n"
                  "        return self._timeout(a), self._timeout(b)\n")
        self.assertEqual(self.helpers_of(source, "Runner._timeout")["one_site"], ["tool.py#Runner._timeout"])

    def test_test_files_do_not_count_as_call_sites(self):
        (self.ws / "test_tool.py").write_text("def test_it():\n    _once(' a ')\n    _once(' b ')\n")
        self.assertEqual(gates.single_caller_helpers(self.ws)["one_site"], ["tool.py#_once"])


def write_side(side: Path, source: str, helpers: list[str]):
    ws = side / "ws"
    (ws / ".codewatch" / "audit").mkdir(parents=True)
    (ws / "tool.py").write_text(source)
    (ws / ".codewatch" / "audit" / "findings.jsonl").write_text("".join(json.dumps(finding(h)) + "\n" for h in helpers))
    db = sqlite3.connect(ws / ".codewatch" / "graph.db")
    db.executescript("create table snapshot (id integer); insert into snapshot values (1);"
                     "create table metric (node_id text, name text, value real, snapshot_id integer);"
                     "insert into metric values ('tool.py#parse', 'symbol_cyclomatic', 1, 1);")
    db.commit()
    db.close()
    metrics = {"test_src_ratio": 0.5, "test_fns": 1, "src_loc": 10, "single_caller": len(helpers)}
    (side / "metrics.json").write_text(json.dumps(metrics))


class HelpersGateTests(unittest.TestCase):
    def run_gates(self, before: str, after: str, helpers_after: list[str]) -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_side(root / "pre", before, [])
            write_side(root / "post", after, helpers_after)
            hidden = {"passed": 1, "failed": []}
            (root / "regrade.json").write_text(json.dumps({"before": {"hidden": hidden}, "after": {"hidden": hidden}}))
            with contextlib.redirect_stdout(io.StringIO()):
                gates.main(str(root / "pre"), str(root / "post"), str(root / "regrade.json"), str(root))
            return json.loads((root / "gates.json").read_text())

    def test_added_multi_site_helper_is_reported_and_neither_passes_nor_fails_the_gate(self):
        before = "def parse(args):\n    return '-v' in args, '-q' in args\n"
        result = self.run_gates(before, SOURCE.replace("_once(args[0])", "args[0]"), ["_flag"])
        self.assertTrue(result["gates"]["helpers"])
        self.assertEqual(result["helpers_multi_site"], {"count": [0, 1], "added": ["tool.py#_flag"]})

    def test_added_one_site_helper_fails_the_gate(self):
        result = self.run_gates("def parse(args):\n    return args\n", SOURCE, ["_once"])
        self.assertFalse(result["gates"]["helpers"])
        self.assertEqual(result["helpers_one_site"], [0, 1])


if __name__ == "__main__":
    unittest.main()
