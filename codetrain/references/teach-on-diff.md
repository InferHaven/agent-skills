# Teach-on-diff (learn from real changes, Socratically)

A local-code variant: instead of inventing an exercise, the tutor turns a **real
diff** — the learner's own uncommitted work, a commit, a branch, or a PR — into a
hands-on walkthrough. The learner re-derives each change themselves; you never paste
the finished diff as the answer (the one hard rule still holds).

## Triggers

"teach me this diff", "walk me through these changes / this PR", "review my diff
Socratically", "explain what I just changed", "quiz me on this PR".

## Get the material (read-only)

Pick the source with the user, then read it with your own tools:

- Their uncommitted work — `git diff` (unstaged) · `git diff --staged` · `git diff HEAD`
- A commit / range / branch — `git diff <base>..<head>` · `git diff main...feature` ·
  `git show <sha>`
- A GitHub PR — `gh pr diff <n>` if `gh` is installed and authed, else fetch the
  branch and `git diff`.

`git diff` is in the prompt-free allow-list; `git show` / `gh` may prompt once at
setup. Read the diff — do **not** paste it wholesale into the lesson.

## Author the lesson

Group the diff into the few **meaningful** hunks (skip noise: formatting, lockfiles,
generated files). For each, author one step:

- `body_md` — the context and the **why**: what problem this change addresses and the
  concept it exercises (a guard added, an API swapped, a loop made lazy, a bug fixed…).
- `starter_code` — the **before-state** of that area (the pre-change lines), or the
  surrounding code with the changed part left as a `# TODO`. **Never the after-state.**
- `task_md` — ask the learner to **produce the change themselves**: reimplement the
  hunk; or, for changes that aren't reproducible exercises (deletions, renames,
  config), **explain** what it does, why it's there, and what would break without it.
- Review against the real after-state (you know it): Socratic feedback, nudge toward
  the actual approach, ask them to justify the trade-off — but never reveal the
  finished lines.

## Mode

- **Their own change, still in the tree** → working on the real file is fine, but seed the editor
  from the *before-state* so they re-derive it; their working tree stays untouched
  until they choose to keep it.
- **A PR or someone else's commit** → use **sandbox** mode (a throwaway copy of the
  before-state) so the exercise never touches their files. Say so plainly.

End and save progress as usual; log any concept they fumbled as a **gap** for spaced
repetition — see `references/spaced-repetition.md`.
