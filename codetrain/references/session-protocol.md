# Session Protocol (read when running a tutor session)

The contract between **you (the tutor brain)** and the **web UI**. The server is
dumb: it serves the UI and reads/writes one JSON file, and it **never executes
user code**. You drive everything by editing that file each turn; the browser
polls it (~1.2s) and renders. You react to the user's browser actions
automatically via a background watcher (see "The auto-review loop").

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

## Launch (once per session, in the background)

First check for a live server and reuse it (don't start a second):

```bash
WS="<workspace>"
if [ -f "$WS/.tutor/url.txt" ] && curl -s --max-time 1 "$(cat "$WS/.tutor/url.txt")/api/state" >/dev/null; then
  echo "reuse $(cat "$WS/.tutor/url.txt")"
else
  bash "$SKILL_DIR/app/ctl.sh" serve "$WS"   # run with run_in_background: true
fi
```

Use `ctl.sh` (not raw `python3 …`/`kill …`) for **serve / watch / stop** — it's a
single stable command form that can be allow-listed once in settings so live
sessions never prompt (see "Frictionless permissions" below).

It prints `TUTOR_URL=http://127.0.0.1:PORT` (also written to `.tutor/url.txt`).
Capture it and give the user the clickable link. Port auto-advances from 7341 if
busy; binds to loopback only. Write `session.json` before/right after launch so
the first poll shows something real.

## Frictionless permissions (one-time)

To avoid per-turn approval prompts during live sessions, add these scoped rules to
settings (`~/.claude/settings.json` or project `.claude/settings.local.json`):

```json
{ "permissions": { "allow": [
  "Read(//tmp/codetrain-*/**)",
  "Write(//tmp/codetrain-*/**)",
  "Bash(bash <SKILL_DIR>/app/ctl.sh:*)"
] } }
```

Replace `<SKILL_DIR>` with the skill's real path (e.g. `~/.claude/skills/codetrain`).
`install.sh` prints these. Skills can't grant permissions at trigger time, so this
one-time allowlist is how sessions stay prompt-free. Everything stays scoped to the
throwaway sandbox + this skill's own control script.

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
sink. Pipe a small JSON **delta** instead:

```bash
printf '%s' '<delta-json>' | bash "$SKILL_DIR/app/ctl.sh" patch <workspace>
```

It deep-merges into the session. Special keys: `clear_inbox:true` → `inbox:[]`;
`learned_append:"…"|[…]` → append to `learned`; `step_patch:{index?,…}` → merge into
`steps[index|active]` (per-step `tests` results / hint tweaks). Emit ONLY the delta —
you never read the file:

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
(no client pass/fail — you review). If not, **Run** is hidden and you run the step's
command via `bash "$SKILL_DIR/app/ctl.sh" run <workspace>` (one allow-listed command —
no per-command prompts). Bash submits never claim "checks passed" client-side.

On wake, the watcher prints the submitted code **and** the `client_tests` summary,
so:

- **If `client_tests` says all passed** → trust it. Do **not** re-run. Give brief
  concept feedback and advance. (Spot-check only if something seems off.)
- **If some failed / no client tests** (bash, repo, or runtime offline) → run
  `tests.cmd` yourself, write `output`/`passed`, and to show the ✓/✗ checklist for
  non-runnable languages fill each `cases[i]` with `passed` (+ `got` on failure).

Keep each turn cheap: **read the watcher output, not the whole file** (Read
`session.json` only if you need more); **≤2–3 tool calls per turn** (one Write to
`session.json`, one Bash to re-arm `watch.sh`, plus a test run only when needed);
**never poll** — rely on the watcher wake; **one watcher at a time**.

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

## Sandbox mode

1. `mktemp -d /tmp/codetrain-XXXXXX` → `<workspace>`.
2. Scaffold a tiny project (a file or two + a test). Tell the user plainly: *this
   is throwaway and touches none of your real files.*
3. `git init` inside it if you want diffs to work like repo mode.

Use sandbox for any request not tied to the current codebase (a random concept, a
generic exercise) — even if the user happens to be inside a repo.

## Learner memory (cheap)

`profile.json` (small) is the cross-session memory. **Start:** read it *only* — to
greet, default the level, suggest a topic, and resurface a due gap (spaced
repetition); surface via the `profile` block + intake `intro`. **End:** append
`history/<date>-<slug>.md` and update `profile.json` (totals, streak by date,
strengths/gaps). Never load `history/` into context unless resuming a specific
past session.

## Teardown

- Write the final recap first: `phase:"done"`, celebratory `title`, `summary_md`,
  full `learned` list — so the last screen is the summary (confetti fires in the UI).
- **Save progress:** append a `history/` summary + update `profile.json` (2 small writes).
- Stop the server: `bash "$SKILL_DIR/app/ctl.sh" stop <workspace>` (and the watcher).
- Sandbox temp dir: leave it, or `rm -rf` only if asked. Never delete repo work.
