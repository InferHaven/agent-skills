"""A file the lesson cites opens beside it, and a secret never does, whoever wrote the list.

In repo mode the agent lists the files a lesson names in `repo_cited`, and the page turns those
paths into buttons that open the file. The agent writes that list, so the server checks every
path itself before it reads anything: only a listed path, inside `repo_root`, not a secret file,
not ignored by git, and text. The secret names are the same list CodeTrain's own repo reader
refuses.

Run from the repository root: python3 -m unittest discover -s tests
"""
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SERVER = Path(__file__).resolve().parents[1] / "codetrain" / "app" / "server.py"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class RepoFile(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        base = Path(cls.tmp.name)
        repo = base / "repo"
        (repo / "src").mkdir(parents=True)
        (repo / "keys").mkdir()
        (repo / "build").mkdir()
        (repo / "src" / "app.py").write_text("print('hello')\n")
        (repo / ".env").write_text("PASSWORD=hunter2\n")
        (repo / ".env.example").write_text("PASSWORD=\n")
        (repo / "keys" / "id_rsa").write_text("-----BEGIN KEY-----\n")
        (repo / "build" / "out.txt").write_text("generated\n")
        (repo / "logo.bin").write_bytes(b"\x89PNG\x00\x01")
        (repo / "notes.txt").symlink_to(repo / ".env")
        (base / "outside.txt").write_text("not in the repo\n")
        cls.git = shutil.which("git") is not None
        if cls.git:
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            (repo / ".gitignore").write_text("build/\n")
        cited = ["src/app.py", ".env", ".env.example", "keys/id_rsa", "build/out.txt",
                 "logo.bin", "notes.txt", "../outside.txt"]
        session = base / "session.json"
        session.write_text(json.dumps({"phase": "learning", "repo_root": str(repo),
                                       "repo_cited": cited}))
        (base / "ws").mkdir()
        cls.port = free_port()
        cls.proc = subprocess.Popen(
            [sys.executable, str(SERVER), "--session", str(session), "--workspace",
             str(base / "ws"), "--port", str(cls.port)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{cls.port}/", timeout=1)
                break
            except OSError:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.tmp.cleanup()

    def get(self, rel):
        url = f"http://127.0.0.1:{self.port}/api/repo-file?path={urllib.parse.quote(rel)}"
        try:
            with urllib.request.urlopen(url, timeout=10) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_a_cited_source_file_opens(self):
        status, body = self.get("src/app.py")
        self.assertEqual(status, 200)
        self.assertEqual(body["content"], "print('hello')\n")

    def test_a_cited_env_template_opens(self):
        self.assertEqual(self.get(".env.example")[0], 200)

    def test_a_cited_secret_never_opens(self):
        for rel in (".env", "keys/id_rsa"):
            status, body = self.get(rel)
            self.assertEqual(status, 404, rel)
            self.assertNotIn("hunter2", json.dumps(body))
            self.assertNotIn("BEGIN KEY", json.dumps(body))

    def test_a_link_that_points_at_a_secret_never_opens(self):
        status, body = self.get("notes.txt")
        self.assertEqual(status, 404)
        self.assertNotIn("hunter2", json.dumps(body))

    def test_a_file_git_ignores_never_opens(self):
        if not self.git:
            self.skipTest("git is not installed")
        self.assertEqual(self.get("build/out.txt")[0], 404)

    def test_a_path_outside_the_repo_never_opens(self):
        self.assertEqual(self.get("../outside.txt")[0], 404)

    def test_a_binary_file_is_refused_as_not_text(self):
        self.assertEqual(self.get("logo.bin")[0], 415)

    def test_a_path_nobody_cited_never_opens(self):
        self.assertEqual(self.get("src/other.py")[0], 404)


if __name__ == "__main__":
    unittest.main()
