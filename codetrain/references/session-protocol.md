# Session Protocol (deep reference)

`SKILL.md` is self-sufficient for a normal session — **read this only for an edge case**
(an unusual field, the full inbox table, debugging the server). It's the complete contract
between **you (the tutor brain)** and the **web UI**: the server is dumb (serves the UI +
one JSON file, **never executes user code**); you edit that file each turn via small
patches; the browser polls (~1.2s) and renders; a background watcher wakes you on the
user's actions (see "The auto-review loop").

## Paths

`$SKILL_DIR` = this skill's base directory (the path shown when the skill loads —
do NOT hardcode `/root/...`; it differs per install).

| Thing | Path |
|-------|------|
| Server | `$SKILL_DIR/app/server.py` (Python 3 stdlib only) |
| Watcher | `$SKILL_DIR/app/watch.sh` |
| Session state | `<workspace>/.tutor/session.json` |
| Discovery / teardown | `<workspace>/.tutor/url.txt`, `<workspace>/.tutor/server.pid` |
| Code the user edits | `<workspace>/<step.file>` |
| Learner profile | `$HOME/.claude/codetrain/profile.json` (small, cross-session) |
| Session history | `$HOME/.claude/codetrain/history/<date>-<slug>.md` |

`<workspace>` = the git repo root (repo mode) or `/tmp/codetrain-XXXX` (sandbox).

## Launch (once per session, detached)

Keep the `.tutor` **session state in `/tmp`** (allow-listed) even in repo mode: make a
session dir with `bash "$SKILL_DIR/app/ctl.sh" sandbox`, then serve it. Reuse a live
server first: **Read** `<session-dir>/.tutor/url.txt` (Read tool); if it answers, reuse.
Otherwise:

```bash
bash "$SKILL_DIR/app/ctl.sh" serve "<session-dir>"            # sandbox
bash "$SKILL_DIR/app/ctl.sh" serve "<session-dir>" "<repo>"   # repo: code writes -> repo
```

`serve` launches the server **detached** (`setsid`+`nohup`) so the page survives even if
your Claude session ends; it prints `TUTOR_URL=http://127.0.0.1:PORT` (also in
`.tutor/url.txt`) and returns. Give the user the link. Use `ctl.sh` (sandbox / serve /
watch / patch / run / stop) **standalone** — never inside a pipe / `;` / `$( )`. Port
auto-advances from 7341; loopback only. On resume in a new session, the reuse-check finds
the live server — just re-arm the watcher.

## Frictionless permissions (one-time)

Skills can't grant permissions at trigger time, so a one-time, scoped allow-list is
how live sessions stay prompt-free. **Run the installer** — it previews every line and
writes nothing without your OK:

```bash
python3 "$SKILL_DIR/app/install-permissions.py"     # merges into ~/.claude/settings.json
# --settings <file> to target another · --dry-run to preview · --yes to skip the prompt
```

It merges this complete, scoped set into `permissions.allow` (additive — it never
rewrites your other rules). `<SKILL_DIR>` and `<HOME>` are written out in full:

```json
{ "permissions": { "allow": [
  "Bash(bash <SKILL_DIR>/app/ctl.sh:*)",         // sandbox/serve/watch/patch/run/stop — the whole loop
  "Read(//tmp/codetrain-*/**)",                  // sandbox + session state + patch.json
  "Write(//tmp/codetrain-*/**)",
  "Edit(//tmp/codetrain-*/**)",
  "Read(//<HOME>/.claude/codetrain/**)",         // learner profile + history
  "Write(//<HOME>/.claude/codetrain/**)",
  "Edit(//<HOME>/.claude/codetrain/**)",
  "Read(//<HOME>/.claude/skills/codetrain/**)",  // the skill's own references the tutor reads
  "Bash(mktemp -d /tmp/codetrain-*)",            // direct mktemp (ctl.sh sandbox also covers this)
  "Bash(git diff:*)"                             // repo-mode review / teach-on-diff (read-only)
] } }
```

This is a **scoped** allow-list, not a bypass — everything else still prompts, which is
exactly what a team/enterprise security review wants. If you rename or move the skill,
re-run the installer so the path rule matches.

**Invocation discipline (matters as much as the rules):** Claude Code checks *every*
segment of a compound/piped command, so one non-listed segment makes the whole thing
prompt. So: call `ctl.sh` **standalone** (never in `|`, `;`, `&&`, or `$( )`); patch by
**writing `<ws>/.tutor/patch.json` with the Write tool** then `ctl.sh patch <ws>` (never
`printf … | …` or a JSON shell-arg — they break on quotes/parens and prompt); do file I/O
with the **Read/Write/Edit tools** (sandbox + profile + skill paths are listed), not bash
`cat`/`echo`/heredocs; make the sandbox with `ctl.sh sandbox`; run a bash step via
`ctl.sh run <ws>`. This is what actually keeps a live session prompt-free.

## The auto-review loop (default interactivity)

The user works in the browser; you stay idle (zero tokens) until they submit.

1. Author a step into `session.json`; set `tutor_status:"listening"`.
2. Launch the watcher in the background (exactly one at a time):
   ```bash
   bash "$SKILL_DIR/app/ctl.sh" watch "<workspace>"
   ```
   (run with `run_in_background: true`)
3. The watcher sleeps until a new **submit / question / end** event lands, prints
   `NEW_EVENT:TYPE` + a payload, and exits — waking you for one turn. (Hints and the
   intake form never wake you.)
4. On wake, branch on the type:
   - **submit** — act on the latest one (double-clicks collapse to one review);
     update `feedback`/`tests`/`learned`; retry or advance `step`/`progress.step`.
   - **question** (Ask button) — answer in `feedback` (status `comment`); keep the step.
   - **end** — write the done screen + save progress (see Teardown).
5. Re-arm the watcher each turn. On `TIMEOUT`, re-arm **silently** (no prose) while
   the session is active; after a few idle cycles with no events, patch
   `tutor_status:"paused"` and stop. The UI shows "say 'arm it' to resume"; the
   user's `arm it` (or a `resume` event) restarts the loop. Never spin-wake.

The user can also just type in the terminal ("check it") — same review turn. Both
paths work.

## session.json schema

```jsonc
{
  "version": 1,
  "mode": "sandbox",                 // "repo" | "sandbox" — sets the badge
  "title": "Parsing CSV by hand in Python",
  "level": null,                     // from intake: beginner|intermediate|advanced
  "goal": null,                      // from intake (user's words)
  "guidance": "balanced",            // from intake: minimal|balanced|guided (hint count / step size)
  "phase": "intake",                 // "intake" | "learning" | "done"
  "intro": "one warm line for the intake screen",     // optional
  "progress": { "step": 1, "total": null },           // total optional
  "tutor_status": "listening",       // listening | thinking | waiting_for_you | paused
  "profile": {                       // optional; rail widget + "welcome back" (from profile.json)
    "welcome": "Welcome back — last time you tackled loops.",
    "streak": 3, "sessions": 4, "concepts": 11
  },
  "summary_md": "",                  // recap shown on the done screen (phase:"done")

  // PREFERRED: author the whole lesson ONCE as steps:[{…}, …] — the UI renders the
  // active one by progress.step, and each step may carry its own "tests". Advancing
  // is then a one-number patch. The single "step"/"tests" below is the legacy form
  // and still works.
  "steps": [ /* { …same shape as "step" + its own "tests"… } */ ],

  "step": {
    "eyebrow": "step 1 of 4",        // optional
    "heading": "Read the file, line by line",
    "body_md": "markdown — concept + WHY, short",
    "task_md": "markdown — the ONE small thing to do now",
    "hints": ["gentle nudge", "more specific", "almost the answer"],
    "file": "main.py",               // relative to workspace; Send writes here
    "lang": "python",                // editor label only
    "starter_code": "def parse(path):\n    pass\n"
  },

  "feedback": { "status": "none", "md": "" },   // "none"|"pass"|"retry"|"comment"
  "tests": {
    "lang": "python",            // python|javascript -> editor highlight + browser RUN;
                                 // bash|shell|others -> highlight only, you run them
    "entry": "largest",          // function the browser calls for each case (py/js only)
    "cases": [                   // structured checks; shown as a ✓/✗ checklist
      { "name": "basic", "args": [[3,7,2,9]], "expected": 9 },
      { "name": "empty", "args": [[]], "expected": null }
    ],
    "cmd": "python -m pytest -q",// optional: YOU run this (repo / bash / complex)
    "output": "", "passed": null // fill these when you run cmd yourself
  },
  "learned": ["Files are iterables of lines"],  // append one line per concept

  "submission": { "ts": 0, "code": "", "note": "" },   // browser writes this
  "inbox": []                        // browser appends events; you drain it
}
```

Supported markdown in `*_md` fields: `## h2`, `### h3`, `**bold**`, `` `inline` ``,
` ``` ` fenced code, `- ` bullets. Keep it tight.

## The inbox

Every browser action appends `{ "ts": <epoch>, "type": ..., ... }` to `inbox`:

| type | payload | meaning |
|------|---------|---------|
| `intake` | `level`, `goal` | intake done — **wakes you** to author the lesson (server also sets top-level `level`/`goal`) |
| `submit` | `code`, `note` | user sent code; server wrote it to the active step's `file` and set `submission` |
| `hint` | `level` | user revealed a nudge — **never wakes you**; note they're stuck |
| `question` | `text`, `code` | the *Ask* button — answer as `feedback` `comment`, keep the step |
| `end` | — | *End session* button — done screen + save progress |
| `resume` | — | user resumed a paused session — set `tutor_status:"listening"`, re-arm |

A `submit` event also carries `client_tests` (`{lang,total,passed}` or null) — the
result of the browser running your `cases` locally — and `review_request` (bool).
`review_request: true` (the "Review my attempt" button) means the user explicitly
wants a full walkthrough **even if the code fails**: always give the substantive
Socratic review, never the brief/skip path. The user may submit failing code
anytime; never refuse it. After handling, clear the inbox via the patch
`clear_inbox: true` (below).

## Updating cheaply — patch deltas (every turn)

Do **not** Read + Write the whole `session.json` each turn — that's the main token
sink. **Write the delta to `<session-dir>/.tutor/patch.json` with the Write tool**, then:

```bash
bash "$SKILL_DIR/app/ctl.sh" patch <session-dir>
```

It applies `patch.json` (deep-merge) and deletes it. The **file** path is robust — JSON
with `(`, quotes, or newlines just works: no shell quoting, no prompt. Do **not** pipe
`printf … | …` or pass the JSON as a shell arg (both break + prompt). Dotted top-level
keys are expanded (`"progress.step": 2`). (An arg / stdin still work as a fallback.)

It deep-merges into the session. Special keys: `clear_inbox:true` → `inbox:[]`;
`learned_append:"…"|[…]` → append to `learned`; `steps_append:{…}|[{…}]` → append new step(s)
(lazy authoring); `step_patch:{index?,…}` → merge into `steps[index|active]` (appends if the
index is out of range — an add never silently drops). Emit ONLY the delta:

```jsonc
// advance after a pass
{"progress":{"step":2},"feedback":{"status":"pass","md":"…"},"learned_append":"…","clear_inbox":true,"tutor_status":"listening"}
// retry (same step)
{"feedback":{"status":"retry","md":"…"},"clear_inbox":true,"tutor_status":"listening"}
// you ran a bash step yourself → show result
{"step_patch":{"tests":{"cmd":"…","output":"…","passed":true}},"clear_inbox":true,"tutor_status":"listening"}
// answer an Ask question (keep the step)
{"feedback":{"status":"comment","md":"…"},"clear_inbox":true,"tutor_status":"listening"}
// idle: pause, then stop re-arming
{"tutor_status":"paused"}
```

The only full `session.json` Write is at session creation (author `steps[]`).

## Instant run, structured tests & token discipline

For **python / javascript** exercises, prefer authoring `tests.cases` (with
`entry`). The browser runs them instantly via WASM/worker — the user self-checks
with the **Run** button before sending. This is the main token saver: fewer
broken submits reach you.

For **bash/shell**: if the server detects a container runtime (docker/podman) it runs
the user's command in a throwaway, network-disabled container and shows real output
(no client pass/fail — you review). **No container? Don't run it yourself** — write the
step so the user runs the command in *their own terminal* and **describes / pastes what
they saw**; you review the description (more Socratic, fewer tokens, zero prompts). Only
to verify a declared check, use `bash "$SKILL_DIR/app/ctl.sh" run <session-dir>`. Bash
submits never claim "checks passed" client-side.

On wake, the watcher prints the submitted code **and** the `client_tests` summary, so:

- **If `client_tests` says all passed** → trust it. Do **not** re-run. Brief concept
  feedback + advance. (Spot-check only if something seems off.)
- **If some failed / no client tests** (bash, repo, or runtime offline) → review the
  user's described output (bash), or run `tests.cmd` yourself (complex py/js), filling
  `output`/`passed` (+ per-case `got` on failure).

Keep each turn cheap: **read the watcher output, never re-Read `session.json`** or the
skill's scripts; patch by **writing `.tutor/patch.json`** (not a full session write);
**≤2–3 tool calls per turn**; **never poll**; **one watcher at a time**.

## Repo mode — the code is REAL

- Workspace = repo root; `step.file` = the real relative path. The server writes
  submissions straight to that file, so a correct submission **is** the working-
  tree change. Nothing to redo afterward.
- **Seed from reality:** read the current file and put its actual contents in
  `starter_code` (optionally add a `# TODO` marking the spot to change), so the
  editor reflects the real file, not a blank.
- Edit in place on the current branch. If on `main`/`master`, offer to create a
  branch first (`git switch -c <name>`). Review with `git diff`.
- On finish: code is already in the working tree; the user commits as usual.
  **Never auto-commit. Never delete repo work.**
- A diff or PR can seed an **entire** lesson — see `references/teach-on-diff.md`
  (the learner re-derives each change from the before-state; never paste the
  finished diff as the answer).

## Sandbox mode

1. `bash "$SKILL_DIR/app/ctl.sh" sandbox` → prints a fresh `/tmp/codetrain-*` workspace
   (with `.tutor/`); use that as `<workspace>`. One standalone allow-listed command —
   don't hand-roll `WS=$(mktemp …)`, which prompts.
2. Scaffold a tiny project (a file or two + a test) by **writing the files with the
   Write tool** — the `/tmp/codetrain-*` path is allow-listed, so this never prompts
   (a bash `cat > file`/heredoc would). Tell the user plainly: *this is throwaway and
   touches none of your real files.*
3. `git init` inside it only if you actually need diffs (it prompts once — skip it for
   non-diff lessons).

Use sandbox for any request not tied to the current codebase (a random concept, a
generic exercise) — even if the user happens to be inside a repo.

## Learner memory (cheap)

`profile.json` (small) is the cross-session memory. **Start:** read it *only* — to
greet, default the level, suggest a topic, and resurface **due gaps** as a quick
review drill (spaced repetition); surface via the `profile` block + intake `intro`.
**End:** append `history/<date>-<slug>.md` and update `profile.json` (totals, streak
by date, strengths; **reschedule reviewed gaps + log new ones**). Gaps are scheduled
records (`due`/`interval_days`/`ease`) — see `references/spaced-repetition.md`. Never
load `history/` into context unless resuming a specific past session.

## Teardown

- Write the final recap first: `phase:"done"`, celebratory `title`, `summary_md`,
  full `learned` list — so the last screen is the summary (confetti fires in the UI).
- **Save progress:** append a `history/` summary + update `profile.json` (2 small writes).
- **Do NOT stop the server** — it self-exits ~90s after the browser renders `done`, so the
  recap + confetti show. (Stopping it the instant you patch `done` races the poll and freezes
  the page on "reviewing".) The watcher exits on its own. (`ctl.sh stop <session-dir>` remains
  for an explicit early teardown.)
- Sandbox temp dir: leave it, or `rm -rf` only if asked. Never delete repo work.
