"""The permission helper adds its rules and removes only the exact rules an older version added.

Run from the repository root: python3 -m unittest discover -s tests
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "codetrain" / "app" / "install-permissions.py"


class PermissionHelper(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.settings = Path(self.tmp.name) / "settings.json"
        self.home = os.path.expanduser("~").rstrip("/").lstrip("/")

    def tearDown(self):
        self.tmp.cleanup()

    def run_helper(self, *extra):
        return subprocess.run([sys.executable, str(SCRIPT), "--skill-dir", "/opt/s/codetrain",
                               "--settings", str(self.settings), *extra],
                              capture_output=True, text=True, check=True).stdout

    def allow(self):
        return json.loads(self.settings.read_text())["permissions"]["allow"]

    def test_old_rules_go_and_the_learners_own_rules_stay(self):
        old = ["Write(//tmp/codetrain-*/**)", "Read(//%s/.codetrain/**)" % self.home,
               "Write(//%s/.codetrain/**)" % self.home, "Edit(//%s/.codetrain/**)" % self.home]
        self.settings.write_text(json.dumps({"permissions": {"allow": ["Bash(ls:*)", *old]}}))
        self.run_helper("--yes")
        allow = self.allow()
        self.assertIn("Bash(ls:*)", allow)
        for rule in old:
            self.assertNotIn(rule, allow)
        self.assertFalse([r for r in allow if r.startswith("Write(")])
        self.assertFalse([r for r in allow if ".codetrain/" in r and "skill" not in r])
        self.assertIn("Edit(//tmp/codetrain-*/**)", allow)
        self.assertIn("nothing to change", self.run_helper("--yes"))

    def test_dry_run_writes_nothing(self):
        self.run_helper("--dry-run")
        self.assertFalse(self.settings.exists())


if __name__ == "__main__":
    unittest.main()
