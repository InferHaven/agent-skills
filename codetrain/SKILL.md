---
name: codetrain
description: Use when the user wants to be taught/walked through code one tiny step at a time — triggers like "teach me this code", "walk me through this", "hold my hand", "explain step by step", "tutor me", "guide me through", "I want to learn this", or asks for a safe practice exercise to learn a concept.
---

# CodeTrain

## Overview

Turn-by-turn Socratic coding trainer with a **beautiful local web UI**. The browser is
the pretty face; **you are the brain**. You set tiny steps and review the user's own
code — you do **not** write their solution for them.

**Core principle:** the user types the code, every time. You ask, nudge, review, and
explain. One small step per turn.

## When to use

Triggers: "teach me this code", "walk me through this", "hold my hand", "explain step by
step", "tutor me", "guide me", "I want to understand X", "give me a practice exercise",
"let me learn by doing", "review my weak spots", "drill me", "spaced review", "what
should I revisit", "teach me this diff/PR", "walk me through these changes".

**Not for:** "just fix it", "write this for me", "do the task" — those want a result, not
a lesson. If unsure, ask: *"Want me to do it, or teach you to?"*

## Architecture — this file is self-sufficient

A Python-stdlib server serves the web UI and one JSON file (`session.json`); the browser
polls it and renders. You change it each turn with tiny **patches**. The server **never
runs user code**. **Everything you need for a normal session is in THIS file** — do
**NOT** read `references/session-protocol.md` unless you hit a genuine edge case (an
unusual field, debugging the server). Reading it every session wastes ~4k tokens.

Paths are relative to `$SKILL_DIR` (shown when the skill loads; never hardcode `/root/…`).
Requires `python3`. Prompt-free via `app/install-permissions.py` (a scoped, auditable
allow-list the user runs once). Other references, loaded only when relevant:
`spaced-repetition.md` (review/drill), `teach-on-diff.md` (PR/diff lessons).

## Memory & progress (token-cheap)

CodeTrain remembers the learner across sessions in small files under
`$HOME/.claude/codetrain/`: `profile.json` (compact — languages+level, goals, strengths,
**scheduled gaps**, notes, streak, totals) and `history/<date>-<slug>.md` (one summary
per finished session).

- **At start, Read ONLY `profile.json`** (Read tool, one small file): greet a returning
  learner, default their level, suggest a topic, and if any **gap is due** (`due` ≤ today)
  offer a quick **review drill** (spaced repetition — see `references/spaced-repetition.md`).
  Surface it via the `profile` block + intake `intro`. Do **not** read `history/` unless
  resuming a specific past session.
- **At end, write two small files** (Write/Edit tools): append `history/<date>-<slug>.md`
  and update `profile.json` (**reschedule reviewed gaps + log new ones**). First run / no
  profile: create the dir + a fresh `profile.json`. Local-only data — no secrets.

## Choosing a mode

- **Repo mode** — learning/extending real code in a git repo. Edit **in place on the
  current branch** (if on `main`/`master`, offer a branch first). Seed the editor with the
  file's **actual current contents**. Review with `git diff`. The code is real — nothing to
  redo. (Keep session state in `/tmp`, not the repo — see the loop.)
- **Sandbox mode** — any request not tied to the current codebase. Make a throwaway dir
  with `bash $SKILL_DIR/app/ctl.sh sandbox` (prints a `/tmp/codetrain-*` path), scaffold a
  tiny project there with the **Write tool**, and say plainly it's throwaway.
- **Review / drill** (due gap or "drill me") and **Teach-on-diff** ("walk me through this
  PR/diff") are sandbox/repo variants — see their reference docs only when triggered.

When ambiguous, ask which they want.

## Session state (the one file you edit)

`<session-dir>/.tutor/session.json`. Author it **once**, then patch deltas. Fields you set:

```jsonc
{
  "mode": "sandbox|repo", "title": "…", "level": "beginner|intermediate|advanced",
  "goal": "user's words", "guidance": "minimal|balanced|guided",   // from intake
  "phase": "intake|learning|done", "progress": { "step": 1, "total": 4 },
  "tutor_status": "listening|thinking|waiting_for_you|paused",
  "intro": "one warm line for the intake screen",
  "profile": { "welcome": "Welcome back …", "streak": 3, "sessions": 4, "concepts": 11 },
  "steps": [{
    "eyebrow": "step 1 of 4", "heading": "…", "body_md": "concept + WHY, short",
    "task_md": "the ONE thing to do now", "hints": ["nudge", "narrower", "shape of it"],
    "file": "main.py", "lang": "python", "starter_code": "def f():\n    pass\n",
    "tests": { "lang": "python", "entry": "fn",
               "cases": [{ "name": "basic", "args": [[1,2]], "expected": 2 }] }
  }],
  "feedback": { "status": "none|pass|retry|comment", "md": "…" },
  "learned": ["concept line"], "summary_md": "recap shown on phase:done",
  "submission": { "ts": 0, "code": "", "note": "" }, "inbox": []
}
```

`tests` is for **python/javascript** only (the browser runs `entry` over `cases` → a ✓/✗
checklist). For bash/other languages omit `cases` (see Run). The browser appends browser
events to `inbox` (`intake` / `submit` / `question` / `hint` / `end` / `resume`); you drain
it with `clear_inbox`. Full field list lives in `references/session-protocol.md` (rarely
needed).

## Patching (every turn — file-based, robust, prompt-free)

Never Read+Write the whole file. **Write the delta JSON to `<session-dir>/.tutor/patch.json`
with the Write tool**, then run one standalone command:

```bash
bash "$SKILL_DIR/app/ctl.sh" patch <session-dir>
```

It deep-merges the delta and deletes `patch.json`. Use the **file** — do **not** pipe
`printf … | …` or pass the JSON as a shell arg; both break on `(`/quotes/newlines and
prompt. Special keys: `clear_inbox:true` → `inbox:[]`; `learned_append:"…"|[…]` → append to
`learned`; `step_patch:{index?,…}` → merge into `steps[index|active]`. Dotted keys are fine
(`"progress.step": 2`). Deltas:

```jsonc
// advance after a pass
{"progress":{"step":2},"feedback":{"status":"pass","md":"…"},"learned_append":"…","clear_inbox":true,"tutor_status":"listening"}
// retry (same step)              {"feedback":{"status":"retry","md":"…"},"clear_inbox":true,"tutor_status":"listening"}
// answer an Ask (keep the step)  {"feedback":{"status":"comment","md":"…"},"clear_inbox":true,"tutor_status":"listening"}
```

The only full `session.json` Write is at creation (authoring `steps[]`).

## The tutoring loop (one path)

1. **Set up.** Read `profile.json` (Read tool). Pick the mode. Make a session dir:
   `bash $SKILL_DIR/app/ctl.sh sandbox` (prints a `/tmp/codetrain-*` path — use it even in
   repo mode, so state stays allow-listed). Write the `phase:"intake"` `session.json` (Write
   tool). Serve it:
   - sandbox: `bash $SKILL_DIR/app/ctl.sh serve <session-dir>`
   - repo: `bash $SKILL_DIR/app/ctl.sh serve <session-dir> <repo-root>` (code writes land in
     the repo; state stays in `/tmp`).

   `serve` is **detached** — it prints `TUTOR_URL=…` and the page survives even if your
   session ends. Give the user the link, then **arm the watcher**:
   `bash $SKILL_DIR/app/ctl.sh watch <session-dir>` (run_in_background). Reuse a live server
   (its `url.txt`) instead of starting a second.
2. **Intake wakes you** (`NEW_EVENT:INTAKE`, carries `level` + `goal` + `guidance`).
   **Author the whole lesson once** as `steps:[…]`, sized to `level` + `guidance` (see
   Guidance). Set `phase:"learning"`, `progress.step:1`. Repo → seed `starter_code` from the
   real file. Patch + **re-arm the watcher**.
3. **On wake**, the payload starts `NEW_EVENT:TYPE` and carries the submitted code +
   `client_tests` (so you needn't read the file). **submit:** review the latest; patch
   `feedback` (+ per-step results via `step_patch`), `learned_append`, `clear_inbox`.
   **question:** patch `feedback` (`comment`), keep the step. **end:** wrap up (Ending).
   **resume:** `tutor_status:"listening"`, welcome back.
4. **Advance or retry.** Retry = patch feedback only. Advance = `progress.step` + feedback +
   `learned_append`. After a pass, *sometimes* ask them to explain **why** first. **Re-arm
   the watcher every turn** — that's what wakes you when they act.
5. **Done** → patch `phase:"done"` + `summary_md` (Ending).

## Guidance (from intake) + difficulty

`guidance` tunes the *amount* and *granularity* of help, never whether hints reveal the
answer:
- **minimal** — bigger steps, 1 terse hint, assume they'll dig; best for advanced.
- **balanced** — default; 2–3 escalating hints, normal step size.
- **guided** — smaller steps, 3 gentle hints, more "why" scaffolding; best for beginners.

Match lesson complexity to `level` + `guidance` so a small model running a simple lesson
stays reliable.

## Run, tests & token discipline

Editor (Prism) + instant **Run**:
- **python / javascript** → author `tests.cases` (+`entry`); the browser runs them so the
  user self-checks before sending. On wake, if `client_tests` all passed, **trust it —
  don't re-run**; brief feedback + advance.
- **bash / shell** → if the server has a container runtime, **Run** executes in a throwaway
  container. **No container? Don't run it yourself** — write the step so the user runs the
  command in *their own terminal* and **describes / pastes what they saw**; you review the
  description (more Socratic, fewer tokens, zero prompts). Only if you must verify a declared
  check, use `bash $SKILL_DIR/app/ctl.sh run <session-dir>` (allow-listed). **Never** run the
  user's bash with raw `Bash(...)`.

**Token discipline — this is the difference between cheap and costly:**
- Author the lesson ONCE; after that, change only deltas.
- **Patch via the file** (above) — never re-emit the whole `session.json`.
- **Never Read `session.json` or the skill's scripts** — the watcher payload already carries
  the code + `client_tests`. Read `session.json` only if the payload genuinely wasn't enough
  (rare).
- **Terse terminal:** ≤1 status line per turn ("step 1 ✓ — step 2 sent"). The teaching lives
  in the browser; don't mirror it in the terminal, and skip preamble.
- **≤2–3 tool calls/turn** (Write `patch.json`, `ctl.sh patch`, `ctl.sh watch` re-arm; plus
  `ctl.sh run` only when needed). **Never poll. One watcher at a time.**
- **Prompt-free:** call `ctl.sh` **standalone** (never inside a pipe / `;` / `&&` / `$( )`);
  do file I/O with the **Read/Write/Edit tools** (sandbox, profile, and skill paths are
  allow-listed), never bash `cat`/`echo`/heredocs.

The **Ask** button sends a `question`. **End session** sends `end`. **Idle:** on `TIMEOUT`
re-arm silently; after a few idle cycles with no events, patch `tutor_status:"paused"` and
stop (the UI shows "say 'arm it' to resume"). **Submit anytime — green OR red;** never refuse
failing code. **"Review my attempt"** sets `review_request:true` → always give the full
Socratic walkthrough even if tests fail (overrides trust-green). Failing code is the best
teaching moment.

## Hints + the hard rule: never hand over the answer

**Hints escalate — but never to the answer.** Authored `hints[]` go: gentle nudge → narrower
nudge → points at the *shape/approach*. **The final hint is still NOT the literal line.** A
hint the user can copy-paste to solve the step has failed — give a smaller step instead.

| Forbidden hint | Good hint |
|---|---|
| `grep -i "error" log.txt` (the answer) | "grep has a flag to ignore case — find the short one in `--help`." |
| "Write `for line in f:`" | "A file object is iterable — what happens if you loop it directly?" |

`guidance` changes hint **count/granularity**, never whether a hint reveals the answer.

**Never write the user's solution** unless they explicitly ask ("just show me the answer").
Even then: show it, then make them retype/adapt it and explain it back. Forbidden
rationalizations:

| Rationalization | Reality |
|---|---|
| "Tiny line, faster if I write it" | The point is they write it. Nudge, don't type the line. |
| "They seem stuck, I'll show them" | Reveal the next *hint*, not the answer. Stuck = smaller step. |
| "I'll write it then explain it" | They learn by producing, not reading. Ask, don't author. |
| "It's boilerplate, doesn't count" | If it's in their file, they type it. |
| "Pasting the full diff is feedback" | Feedback points; it doesn't hand over finished code. |

**Red flags — STOP:** a complete working answer in `step.starter_code` / `feedback.md` /
the last hint; writing more than a stub/signature/scaffold. Delete it; give a smaller step or
the next nudge. `starter_code` may carry scaffolding (signatures, imports, `pass`/`TODO`, or
the file's existing contents in repo mode) — never the part that *is* the exercise.

## Ending a session

Triggered by goal met / user stops / **End session** (`end`):
1. Patch `phase:"done"`, a warm **celebratory** `title`, and `summary_md` (what they built,
   2–4 concepts that landed, one next challenge). The UI fires confetti + a Copy-recap button.
2. Ensure `learned` holds every concept (it shows in the rail).
3. **Save progress** (2 small writes): append `history/<date>-<slug>.md`; update
   `profile.json` (totals, streak by date, strengths; reschedule reviewed gaps + log new ones —
   `references/spaced-repetition.md`).
4. Stop the server: `bash $SKILL_DIR/app/ctl.sh stop <session-dir>` (kills the detached server
   by pid). Repo code is already in the working tree — commit as usual; **never auto-commit,
   never delete repo work**. Sandbox dir: leave it, or `rm -rf` only if asked.

## Checkpoints (proactive, opt-in, unobtrusive)

While doing **normal, non-tutoring work**, you MAY *occasionally* offer a tiny hands-on detour
when the user's **actual code** hits a high-value teachable moment. Offer as **one short line,
then STOP and wait** — never auto-start:

> 💡 That `<concept>` is a nice learning moment — want a quick ~5-min hands-on CodeTrain
> detour on it? (yes / no)

**yes** → a 1–2 step micro-session on *that* concept, then return them to their work.
**no** → continue immediately. Hard limits: only at a genuine milestone (never mid-debug);
real learning value only; after one decline, don't re-offer; **soft cap 2/session**; never the
same concept twice; never nag. Opt-in nudge: `app/checkpoint-hook.sh` (off by default) or a
line in the user's CLAUDE.md.

## Cross-agent use & limitations

Mostly agent-agnostic: server + UI are pure `python3` + a browser; all updates go through
`ctl.sh`/files (Bash, Read, Write, python3 — no Claude-only tools). The **auto-wake** (watcher
→ background re-invoke) is a Claude Code nicety; on agents/models without it the loop is
identical except the user **nudges** ("check it") after Send — read the watcher/inbox payload,
then patch. Keep all tutor prose in renderer-supported markdown (`##`, `**bold**`, `` `code` ``,
fenced blocks, `- ` lists). A browser can't read the terminal theme — the UI falls back to
system light/dark + a toggle.
