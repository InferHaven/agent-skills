"""The answer guard holds back code that writes a step out, and nothing else.

The two leak fixtures are real tutor turns, the same ones CodeTrain's hosted tutor is tested
with. Run from the repository root: python3 -m unittest discover -s tests
"""
import copy
import importlib.util
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "codetrain" / "app"
spec = importlib.util.spec_from_file_location("answer_guard", APP / "answer_guard.py")
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

JS_STEP = {
    "task_md": "Capture the original `scores` array before calling `topThree`, then fail if the "
               "array was mutated.",
    "body_md": "A function that sorts in place changes its caller's array.",
}
JS_CODE = """const scores = [72, 98, 64, 91, 87, 55];
const ogscores = scores;
topThree(scores);
if (scores != ogscores) { throw new Error("mutated!"); }
"""
JS_LEAK = """You spotted the problem yourself - `scores != ogscores` is comparing two array \
references, not their contents.

You need to compare the values element by element. One clean way: serialize both to strings.

```js
JSON.stringify(scores) !== JSON.stringify(ogscores)
```

Swap your condition to use that, then also call `badtopThree` to confirm the check throws."""

SH_STEP = {
    "task_md": "Print all three words, one per line, then pipe that single output into one "
               "`grep` command that keeps only the words starting with `a`.",
    "body_md": "A pipeline sends one command's stdout into the next command's stdin.",
}
SH_CODE = """echo apple | grep '^a'
echo banana | grep '^a'
echo avocado | grep '^a'
"""
SH_LEAK = """Good instinct testing `grep '^a'` on each word - it works! But the task asks you to \
print all three words first and then pipe that single output into one grep command.

Right now you have three separate pipes. The goal is one pipeline:

```
<print all three words> | grep '^a'
```

Hint: `printf 'apple\\nbanana\\navocado\\n'` prints all three words at once."""


class Guard(unittest.TestCase):
    def test_the_javascript_answer_is_held_and_their_own_line_stays(self):
        out, held = g.sanitize_feedback(JS_LEAK, JS_STEP, JS_CODE)
        self.assertNotIn("JSON.stringify(scores) !== JSON.stringify(ogscores)", out)
        self.assertIn("JSON.stringify(scores) !== JSON.stringify(ogscores)", held)
        self.assertIn("`scores != ogscores`", out, "quoting their own code is fair")
        self.assertTrue(out.endswith(g.FEEDBACK_HELD_NOTE))

    def test_the_bash_answer_is_held_and_the_holed_shape_stays(self):
        out, held = g.sanitize_feedback(SH_LEAK, SH_STEP, SH_CODE)
        self.assertNotIn("printf", out)
        self.assertTrue(any("printf" in h for h in held))
        self.assertIn("<print all three words> | grep '^a'", out)

    def test_an_unrelated_example_and_plain_prose_pass_untouched(self):
        md = "A generic illustration: `const person = { name: \"Ada\" }` has one property."
        self.assertEqual(g.sanitize_feedback(md, JS_STEP, JS_CODE), (md, []))
        self.assertEqual(g.sanitize_feedback("Nice work, that runs.", JS_STEP, JS_CODE),
                         ("Nice work, that runs.", []))

    def test_no_known_step_refuses_every_expression(self):
        out, held = g.sanitize_feedback("Try `JSON.stringify(a) !== JSON.stringify(b)`.")
        self.assertEqual(held, ["JSON.stringify(a) !== JSON.stringify(b)"])


class PageView(unittest.TestCase):
    def state(self):
        return {"phase": "learning", "progress": {"step": 1},
                "steps": [dict(JS_STEP, hints=["Compare the contents, not the references.",
                                               "Use `JSON.stringify(scores) !== JSON.stringify(ogscores)`."])],
                "submission": {"code": JS_CODE},
                "feedback": {"status": "retry", "md": JS_LEAK}}

    def test_feedback_and_hints_are_guarded_and_the_file_is_not_touched(self):
        state = self.state()
        before = copy.deepcopy(state)
        view = g.guard_state(state)
        self.assertEqual(state, before, "the tutor's own session data is never changed")
        self.assertIn("JSON.stringify(scores) !== JSON.stringify(ogscores)", view["feedback"]["held"])
        hints = view["steps"][0]
        self.assertEqual(hints["hints"][0], "Compare the contents, not the references.")
        self.assertNotIn("JSON.stringify", hints["hints"][1])
        self.assertEqual(hints["hints_held"][0], [])
        self.assertTrue(hints["hints_held"][1])

    def test_a_step_already_passed_is_no_longer_protected(self):
        state = self.state()
        state["steps"].append({"task_md": "Now print the top score with `max`."})
        state["progress"] = {"step": 2}
        state["submission"] = {"code": ""}
        view = g.guard_state(state)
        self.assertNotIn("held", view["feedback"], "a closing note about the passed step stays")


if __name__ == "__main__":
    unittest.main()
