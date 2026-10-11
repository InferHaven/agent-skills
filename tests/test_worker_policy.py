"""The two browser workers fetch from Pyodide's CDN and nowhere else.

A worker takes its content security policy from the response that delivered its script, so the
lesson page's server sends one with each worker script: scripts and fetches from the server
itself and from jsDelivr, where Pyodide and the packages it bundles come from. Without it, the
Python worker's fallback for a package Pyodide does not bundle (micropip) would fetch from PyPI,
which the README promises it does not. CodeTrain's own study page sends the same policy.

Run from the repository root: python3 -m unittest discover -s tests
"""
import json
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

SERVER = Path(__file__).resolve().parents[1] / "codetrain" / "app" / "server.py"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class WorkerPolicy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        session = Path(cls.tmp.name) / "session.json"
        session.write_text(json.dumps({"phase": "intake"}))
        (Path(cls.tmp.name) / "ws").mkdir()
        cls.port = free_port()
        cls.proc = subprocess.Popen(
            [sys.executable, str(SERVER), "--session", str(session),
             "--workspace", str(Path(cls.tmp.name) / "ws"), "--port", str(cls.port)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                urllib.request.urlopen(cls.url("/"), timeout=1)
                break
            except OSError:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.tmp.cleanup()

    @classmethod
    def url(cls, path):
        return f"http://127.0.0.1:{cls.port}{path}"

    def policy(self, path):
        with urllib.request.urlopen(self.url(path), timeout=5) as r:
            return r.headers.get("Content-Security-Policy")

    def test_each_worker_may_fetch_only_from_here_and_jsdelivr(self):
        for worker in ("/pyodide-worker.js", "/js-worker.js"):
            policy = self.policy(worker)
            self.assertIsNotNone(policy, worker)
            directives = dict(d.strip().split(" ", 1) for d in policy.split(";") if d.strip())
            self.assertEqual(directives["connect-src"], "'self' https://cdn.jsdelivr.net", worker)
            self.assertIn("https://cdn.jsdelivr.net", directives["script-src"], worker)
            self.assertIn("'unsafe-eval'", directives["script-src"], worker)
            self.assertNotIn("pypi", policy, worker)

    def test_the_lesson_page_itself_keeps_no_policy(self):
        """The page is untouched: the policy is about what the workers may fetch."""
        self.assertIsNone(self.policy("/"))
        self.assertIsNone(self.policy("/app.js"))


if __name__ == "__main__":
    unittest.main()
