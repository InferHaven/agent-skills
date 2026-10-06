"""A bash step that never ends is stopped at the time limit, and its container is gone.

Needs docker or podman with a small image (alpine, busybox, bash, ubuntu or debian); skips
otherwise. Run from the repository root: python3 -m unittest discover -s tests
"""
import importlib.util
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

SERVER = Path(__file__).resolve().parents[1] / "codetrain" / "app" / "server.py"


def load_server():
    spec = importlib.util.spec_from_file_location("codetrain_server", SERVER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class ContainerRunner(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = load_server()
        if not (cls.server.RUNTIME and cls.server.RUN_IMAGE):
            raise unittest.SkipTest("no container runtime with a usable image")

    def leftovers(self):
        out = subprocess.run([self.server.RUNTIME, "ps", "-q", "--filter", "name=codetrain-run-"],
                             capture_output=True, text=True)
        return out.stdout.split()

    def test_a_normal_step_prints_its_output(self):
        with tempfile.TemporaryDirectory() as ws:
            r = self.server.run_in_container(ws, "echo hello")
        self.assertEqual((r["stdout"], r["exit"]), ("hello\n", 0))

    def dash_image(self):
        """BusyBox sh exits on the forwarded SIGTERM, so the bug only shows under a shell that
        honours the trap: Debian's and Ubuntu's dash. Use one when it is already pulled."""
        out = subprocess.run([self.server.RUNTIME, "images", "--format", "{{.Repository}}:{{.Tag}}"],
                             capture_output=True, text=True).stdout.split()
        return next((i for i in out if i.split(":")[0].split("/")[-1] in ("debian", "ubuntu")),
                    self.server.RUN_IMAGE)

    def test_a_loop_that_ignores_sigterm_is_stopped_and_removed(self):
        saved = self.server.RUN_TIMEOUT, self.server.RUN_IMAGE
        self.server.RUN_TIMEOUT, self.server.RUN_IMAGE = 6, self.dash_image()
        start = time.monotonic()
        try:
            with tempfile.TemporaryDirectory() as ws:
                r = self.server.run_in_container(ws, "trap '' TERM INT; while :; do sleep 1; done")
        finally:
            self.server.RUN_TIMEOUT, self.server.RUN_IMAGE = saved
        took = time.monotonic() - start
        self.assertEqual((r["stderr"], r["exit"]), ("timed out", 124))
        self.assertLess(took, 20, "the timeout must not wait for the program to give up")
        for _ in range(20):
            if not self.leftovers():
                break
            time.sleep(0.5)
        self.assertEqual(self.leftovers(), [], "the timed-out container is still running")


if __name__ == "__main__":
    unittest.main()
