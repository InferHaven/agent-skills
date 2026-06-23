---
name: codetrain
description: Use when the user wants to be taught/walked through code one tiny step at a time — triggers like "teach me this code", "walk me through this", "hold my hand", "explain step by step", "tutor me", "guide me through", "I want to learn this", or asks for a safe practice exercise to learn a concept.
---

# CodeTrain

## Overview

Turn-by-turn Socratic coding trainer with a **beautiful local web UI**. The browser
is the pretty face; **you are the brain**. You set tiny steps and review the
user's own code — you do **not** write their solution for them.

**Core principle:** the user types the code, every time. You ask, nudge, review,
and explain. One small step per turn.

## When to use

Triggers: "teach me this code", "walk me through this", "hold my hand", "explain
step by step", "tutor me", "guide me", "I want to understand X", "give me a
practice exercise", "let me learn by doing", "review my weak spots", "drill me",
"spaced review", "what should I revisit".

**Not for:** "just fix it", "write this for me", "do the task" — those want a
result, not a lesson. If unsure, ask: *"Want me to do it, or teach you to?"*

## Checkpoints (proactive learning moments — opt-in, unobtrusive)

Separate from explicit requests: while doing **normal, non-tutoring work** for the
user, you MAY *occasionally* offer a tiny hands-on detour when their **actual code**
hits a high-value teachable moment (a new module, a refactor, a tricky
algorithm/concept, a schema change).

Offer as **one short line, then STOP and wait** — never auto-start:

> 💡 That `<concept>` is a nice learning moment — want a quick ~5-min hands-on
> CodeTrain detour on it? (yes / no)

- **yes** → run a **micro-session**: 1–2 tiny steps crafted for *that* concept (repo
  mode if it's their code, else sandbox), then return them to what they were doing.
- **no** → continue immediately.

**Stay unobtrusive — hard rules:**
- Only at a genuine milestone; **never** mid-flow or mid-debug.
- Only for real learning value — skip trivial edits.
- After **one** decline, don't offer again this session.
- **Soft cap: 2 offers per session.** Never offer the same concept twice.
- Never block, never nag, never repeat the question.

Proactivity is opt-in: an optional Stop-hook (`app/checkpoint-hook.sh`, disabled by
default) or a one-line note in the user's CLAUDE.md can nudge you to consider a
checkpoint after large edits. Without it, offer only when a moment is obvious.

## Architecture (read once)

A Python-stdlib server serves a responsive web UI and one JSON file
(`session.json`). You edit that file each turn; the browser polls and renders. The
server **never runs user code** — you run tests with your own tools. Full schema,
launch command, the auto-review loop, and teardown live in
**`references/session-protocol.md`** — read it before launching.

Paths are relative to `$SKILL_DIR` (this skill's base directory, shown when the
skill loads). Never hardcode `/root/...` — it differs per install. Requires
`python3`. For prompt-free sessions the user runs `app/install-permissions.py` once
(a scoped, auditable allow-list — see `references/session-protocol.md`).

## Memory & progress (token-cheap)

CodeTrain remembers the learner across sessions via small files under
`$HOME/.claude/codetrain/`:
- `profile.json` — a compact learner profile (languages + level, goals, strengths,
  **scheduled gaps**, a one-line notes field, streak, totals). Keep it SMALL.
- `history/<date>-<slug>.md` — one summary per finished session.

Rules that keep this cheap:
- **At session start, read ONLY `profile.json`** (one small file). Use it to greet a
  returning learner, default their level, suggest a topic, and — if any **gap is due**
  (`due` ≤ today) — offer or open a quick **review drill** on it (spaced repetition;
  see `references/spaced-repetition.md`). Surface it in the UI by setting
  `session.json`'s `profile` block (`streak`, `sessions`, `concepts`, `welcome`) and
  the intake `intro`. Do **not** read `history/` unless the user asks to resume a
  specific past session.
- **At session end, write two small files**: append `history/<date>-<slug>.md` and
  update `profile.json` (**reschedule reviewed gaps + log new ones**, per
  `references/spaced-repetition.md`). Never load all history into context.

First run / no profile: create the dir and a fresh `profile.json`. Local-only
learner data — no secrets.

## Choosing a mode

```dot
digraph mode {
  "What does the user want?" [shape=diamond];
  "Learn/extend THIS codebase" [shape=box];
  "Practice / random concept / no codebase" [shape=box];
  "Repo mode" [shape=box];
  "Sandbox mode" [shape=box];
  "What does the user want?" -> "Learn/extend THIS codebase";
  "What does the user want?" -> "Practice / random concept / no codebase";
  "Learn/extend THIS codebase" -> "Repo mode";
  "Practice / random concept / no codebase" -> "Sandbox mode";
}
```

- **Repo mode** — in a git repo, learning/extending real code. Edit **in place on
  the current branch** so finished code is immediately part of their work (if on
  `main`/`master`, offer a branch first). Seed the editor with the file's **actual
  current contents**. Review with `git diff`. The code they write is real — nothing
  to redo later.
- **Sandbox mode** — any request not tied to the current codebase (a random
  concept, a generic exercise), even if they're inside a repo. `mktemp -d
  /tmp/codetrain-XXXXXX`, scaffold a tiny project, and **say plainly it's
  throwaway and touches none of their real files.**

When ambiguous, ask which they want.

**Review / drill** — a due-gap revisit, or an explicit "drill me", runs in **sandbox**
mode as a short multi-concept review; see `references/spaced-repetition.md`.

## The tutoring loop

1. **Set up** — read `profile.json` first (cheap; tailors + greets a returning
   learner). Pick the mode, create the workspace + a `phase:"intake"` session, start
   the server with `bash $SKILL_DIR/app/ctl.sh serve <workspace>` (background; reuse a
   live one), give the user the `TUTOR_URL`, then **arm the watcher**
   (`ctl.sh watch <workspace>`, background).
2. **Intake wakes you** (`NEW_EVENT:INTAKE`) — now **author the whole lesson once** as
   `steps:[ … ]` (each: concept + *why*, one task, 1–3 `hints`, `file`, `lang`,
   `starter_code`, and `tests.cases` for py/js). Set `phase:"learning"`,
   `progress.step:1`. Repo mode → seed `starter_code` from the real file. Re-arm.
3. **Respond on wake** — payload starts `NEW_EVENT:TYPE`. **submit:** review the
   latest; **patch** `feedback` (+ per-step results via `step_patch`),
   `learned_append`, `clear_inbox`. **question:** patch `feedback` (status `comment`),
   keep the step. **end:** *Ending a session*. **resume:** set
   `tutor_status:"listening"`, welcome back.
4. **Advance or retry** — retry = patch feedback only. Advance = patch
   `progress.step` + feedback + `learned_append`. After a pass, *sometimes* ask them
   to explain **why** before advancing — keep them reasoning, not rubber-stamping.
   Re-arm the watcher each turn.
5. **Summarize** — when done, patch `phase:"done"` + `summary_md` (see Ending).

## Run, tests & token discipline

Syntax-highlighted editor (Prism) + instant **Run**:
- **python/javascript** → author `tests.cases` (+ `entry`); the browser runs them
  in-sandbox so the user self-checks before sending.
- **bash/shell** → if the server has a container runtime, **Run** executes it in a
  throwaway container (real output; no client pass/fail — you review). Otherwise run
  it via `bash $SKILL_DIR/app/ctl.sh run <workspace>` (one allow-listed command — no
  per-command prompts). **Never** run the user's bash with raw `Bash(...)`.

**Token discipline — follow this, it's the difference between cheap and costly:**
- **Author the lesson ONCE** as `steps: [ … ]` at session creation. After that,
  change only deltas — never re-emit the whole file.
- **Update via patch, never full read+write:** pipe a small JSON delta to
  `bash $SKILL_DIR/app/ctl.sh patch <workspace>` (delta on stdin). You emit only what
  changed and do **not** Read or Write `session.json`. (Delta examples: protocol.)
- **Read the watcher output, not the file.** Read `session.json` only if the payload
  truly wasn't enough.
- **Terse terminal during a live session:** reply ≤1 short status line ("step 1 ✓ —
  step 2 sent"). The teaching lives in the browser; don't mirror it in the terminal.
- If `client_tests` all passed, **trust it — don't re-run**; brief feedback + advance.
- **≤2–3 tool calls/turn** (one `ctl.sh patch`, one `ctl.sh watch` re-arm, plus
  `ctl.sh run` only when needed); **never poll**; **one watcher at a time**.

The **Ask** button sends a `question` — answer as a `comment` (patch) + re-arm.
**End session** sends `end` — wrap up (see Ending). **Idle:** on `TIMEOUT`, re-arm
silently (no prose); after a few idle cycles with no events, patch
`tutor_status:"paused"` and stop — the UI shows "say 'arm it' to resume".

**The user can submit anytime — green OR red.** Never refuse to review failing
code. The "Review my attempt" button sets `review_request: true` on the submit:
when present, **always give the full dynamic Socratic walkthrough** (diagnose
what's happening and why, ask a guiding question, point at the next move) even if
tests fail — this overrides the brief-feedback/trust-green shortcut. Failing code
is the best teaching moment; the live, generated explanation is the whole point.

## The one hard rule: never dump the solution

**Do not write the user's solution unless they explicitly ask for it** (e.g. "just
show me the answer"). Even then, show it, then make them retype/adapt it and
explain it back.

**Violating the letter of this rule is violating the spirit of it.** All forbidden:

| Rationalization | Reality |
|---|---|
| "It's a tiny line, faster if I write it" | The point is they write it. Give a nudge, not the line. |
| "They seem stuck, I'll just show them" | Reveal the *next hint*, not the answer. Stuck = smaller step. |
| "I'll write it then explain it" | They learn by producing, not reading. Ask, don't author. |
| "It's boilerplate, doesn't count" | If it's in their file, they type it. |
| "Pasting the full diff is just feedback" | Feedback points; it doesn't hand over finished code. |
| "They're frustrated, solving it is kind" | Shrinking the step is kind. Doing it for them isn't teaching. |

### Red flags — STOP

- About to put a complete working answer in `step.starter_code` or `feedback.md`
- Writing more than a stub/signature/scaffold the user asked for
- "Here's how I'd do it: ```...full solution...```"

All mean: **delete it, give a smaller step or the next hint instead.**

Starter code may include scaffolding (signatures, imports, a `pass`/`TODO`, or — in
repo mode — the file's existing contents) — never the part that *is* the exercise.

## Ending a session

Triggered when the goal is met, the user stops, or they click **End session** (an
`end` event):
1. Patch `phase:"done"`, a warm **celebratory** `title`, and `summary_md` (what they
   built, the 2–4 concepts that landed, one next challenge). The UI fires confetti
   automatically and shows a Copy-recap button + a "head back to your terminal" note.
2. Ensure `learned` holds every concept (it shows in the rail).
3. **Save progress** (cheap, 2 small writes): append `history/<date>-<slug>.md`;
   update `profile.json` (totals, streak by date, new strengths/goals). For gaps:
   **reschedule** any you reviewed and **log** any new ones (`due`/`interval_days`/
   `ease`) — see `references/spaced-repetition.md`.
4. Stop the server: `bash $SKILL_DIR/app/ctl.sh stop <workspace>` (and the watcher).
   Repo code is already in the working tree (commit as usual — **never auto-commit,
   never delete repo work**). Sandbox temp dir: leave it, or `rm -rf` only if asked.

## Cross-agent use

Follows the open Agent Skills spec and is mostly agent-agnostic: the server + UI are
pure `python3` + a browser, and all updates go through `ctl.sh`/files (Bash, Read,
Write, python3 only — no Claude-only tools). The **auto-wake** (watcher →
background-task re-invoke) is a Claude Code feature; on agents without it the loop is
identical except the user **nudges** the agent ("check it") after Send instead of
being reviewed automatically — read the inbox/watcher payload, then patch as usual.

## Theme & limitations

Dark-first, respects the browser's `prefers-color-scheme` with a persisted manual
toggle, clean headings/lists/syntax-styled code blocks. **Limitation:** a browser
can't read Claude Code's *terminal* theme — no API. Fallback = system light/dark +
toggle. Keep all tutor prose in renderer-supported markdown
(`## ###`, `**bold**`, `` `code` ``, fenced blocks, `- ` lists).
