"""The profile script: the brief leaves private fields out, and updates follow the review rules.

Run from the repository root: python3 -m unittest discover -s tests
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "codetrain" / "app" / "profile.py"


class ProfileScript(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name) / "ct"
        self.env = dict(os.environ, CODETRAIN_HOME=str(self.home))

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, *args):
        out = subprocess.run([sys.executable, str(SCRIPT), *args], env=self.env,
                             capture_output=True, text=True, check=True)
        return out.stdout

    def brief(self, day):
        return json.loads(self.run_script("brief", "--today", day))

    def update(self, delta, day):
        path = Path(self.tmp.name) / "profile-delta.json"
        path.write_text(json.dumps(delta))
        line = self.run_script("update", str(path), "--today", day)
        self.assertFalse(path.exists(), "the delta is deleted once applied")
        return line

    def profile(self):
        return json.loads((self.home / "profile.json").read_text())

    def write_profile(self, prof):
        self.home.mkdir(parents=True, exist_ok=True)
        (self.home / "profile.json").write_text(json.dumps(prof))

    def test_a_first_run_has_an_empty_brief(self):
        b = self.brief("2026-10-06")
        self.assertFalse(b["returning"])
        self.assertEqual(b["due_gaps"], [])

    def test_the_brief_leaves_strengths_notes_and_later_gaps_out(self):
        self.write_profile({
            "level": "intermediate", "languages": ["python"], "sessions": 4, "streak": 2,
            "concepts": 17, "last_session": "2026-10-01",
            "goals": ["an older goal", "BGP route reflection"],
            "strengths": ["a private strength"], "notes": "a private note about the learner",
            "gaps": [{"concept": "closures", "lang": "javascript", "due": "2026-10-05"},
                     {"concept": "later gap", "due": "2026-12-01"}, "legacy string gap"]})
        raw = self.run_script("brief", "--today", "2026-10-06")
        for private in ("a private strength", "a private note", "later gap", "an older goal"):
            self.assertNotIn(private, raw)
        b = json.loads(raw)
        self.assertTrue(b["returning"])
        self.assertEqual(b["latest_goal"], "BGP route reflection")
        self.assertEqual([g["concept"] for g in b["due_gaps"]], ["closures", "legacy string gap"])
        self.assertEqual(b["not_shared"], {"strengths": 1, "notes": True, "other_gaps": 1,
                                           "older_goals": 1, "history_files": 0})

    def test_full_prints_everything_when_asked(self):
        self.write_profile({"notes": "shared on request"})
        self.assertIn("shared on request", self.run_script("brief", "--full"))

    def test_the_worked_example_from_the_reference(self):
        self.write_profile({"gaps": [{"concept": "list vs generator", "lang": "python",
                                      "due": "2026-06-23", "interval_days": 3, "ease": 2.0,
                                      "last_seen": "2026-06-20"}]})
        self.update({"reviewed": [{"concept": "List vs Generator", "result": "solid"}]}, "2026-06-23")
        g = self.profile()["gaps"][0]
        self.assertEqual((g["ease"], g["interval_days"], g["due"]), (2.15, 6, "2026-06-29"))
        self.update({"reviewed": [{"concept": "list vs generator", "result": "shaky"}]}, "2026-06-29")
        g = self.profile()["gaps"][0]
        self.assertEqual((g["ease"], g["interval_days"], g["due"]), (1.95, 1, "2026-06-30"))

    def test_a_solid_review_after_three_weeks_is_mastered(self):
        self.write_profile({"gaps": [{"concept": "recursion", "due": "2026-10-06",
                                      "interval_days": 21, "ease": 2.5}], "strengths": []})
        self.update({"reviewed": [{"concept": "recursion", "result": "solid"}]}, "2026-10-06")
        prof = self.profile()
        self.assertEqual(prof["gaps"], [])
        self.assertEqual(prof["strengths"], ["recursion"])

    def test_totals_streak_new_gaps_and_history(self):
        self.update({"title": "List comprehensions", "language": "python", "goal": "learn Python",
                     "learned": ["list comprehension", "filter clause"],
                     "new_gaps": [{"concept": "nested comprehensions", "lang": "python"}],
                     "summary_md": "You wrote two comprehensions."}, "2026-10-06")
        self.update({"learned": ["dict comprehension"]}, "2026-10-07")
        prof = self.profile()
        self.assertEqual((prof["sessions"], prof["concepts"], prof["streak"]), (2, 3, 2))
        self.assertEqual(prof["languages"], ["python"])
        self.assertEqual(prof["goals"], ["learn Python"])
        self.assertEqual(prof["gaps"][0]["due"], "2026-10-07")
        self.update({}, "2026-10-09")
        self.assertEqual(self.profile()["streak"], 1, "a missed day resets the streak")
        names = sorted(os.listdir(self.home / "history"))
        self.assertEqual(names[0], "2026-10-06-list-comprehensions.md")
        self.assertIn("You wrote two comprehensions.", (self.home / "history" / names[0]).read_text())

    def test_the_update_line_never_prints_the_profile(self):
        self.write_profile({"notes": "keep this private"})
        line = self.update({"learned": ["x"]}, "2026-10-06")
        self.assertNotIn("keep this private", line)
        self.assertTrue(line.startswith("profile updated:"))


if __name__ == "__main__":
    unittest.main()
