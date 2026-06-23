# CodeTrain

An **Agent Skill** (tested mostly on Claude Code; works on any Agent-Skills-compatible agent)
that turns any coding question into a hands-on, **one-tiny-step-at-a-time** tutorial
in a clean, responsive **web UI** — the style of the popular code-learning sites, but
driven by your agent and your own editor.

You write the code; Claude asks, nudges, reviews your submission, runs the tests,
and explains what changed. It never dumps the solution on you.

![modes: repo + sandbox](#) <!-- screenshot optional -->

## How it works

- A tiny **Python-stdlib** web server (zero dependencies) serves the UI and one
  JSON state file. **The server never executes your code.**
- A **syntax-highlighted** editor (vendored **Prism** overlay — no runtime CDN,
  works offline; falls back to a plain textarea) with an instant **Run** button:
  **Python** runs in-browser via Pyodide (WASM), **JavaScript** in a sandboxed
  worker — so you self-check against a ✓/✗ test checklist before sending.
  **Bash/shell** runs in a throwaway, network-disabled **container** right from the
  page when `docker`/`podman` is available (else the agent runs it for you).
- You work in the browser; clicking **Send to tutor** wakes the active Claude Code
  session to review automatically (Claude idles at ~zero token cost while you
  code). Running locally first keeps tutor turns rare and cheap — but you can
  **Review my attempt** anytime to get a full, generated walkthrough of *failing*
  code too. Hints are local and never cost a turn.
- **Ask** a question anytime (no code needed), **Run** with `⌘/Ctrl+↵`, and **End
  session** (two-click, can't misfire) for a celebratory recap + confetti.
- **Remembers you:** a small local profile (`~/.claude/codetrain/profile.json`)
  tracks your level, streak, and recurring gaps — tailoring future sessions and
  resurfacing things you struggled with (spaced repetition). One small read at the
  start, two small writes at the end; no token bloat.
- **Learning checkpoints (opt-in):** while you do normal work, Claude can offer a
  short, tailored micro-session when your *actual* code hits a teachable moment —
  one line, accept/deny, strictly throttled (never nags).
- Two modes:
  - **Repo mode** — learn/extend your real codebase. Edits land **in place** on
    your current branch, so finished code is just part of your work — nothing to
    redo. (On `main`/`master` it offers a branch first.)
  - **Sandbox mode** — a throwaway project under `/tmp/codetrain-*` for
    practice or any concept not tied to a codebase. Touches none of your files.

## Requirements

- An agent that supports Agent Skills (Claude Code recommended)
- `python3` (standard library only — nothing to `pip install`)
- Optional: `docker` or `podman` for **in-browser bash** (otherwise bash is run by
  the agent)

## Install

**Use it (any user):**

```bash
git clone <this-repo> && cd <repo>/codetrain
./install.sh            # copies into ~/.claude/skills/codetrain
```

Restart Claude Code.

**Develop it (live edits):** symlink instead of copy —

```bash
ln -s "$PWD/codetrain" ~/.claude/skills/codetrain
```

## Use

Just ask, in Claude Code:

- "teach me this code"
- "walk me through this function step by step"
- "hold my hand through adding X"
- "give me a practice exercise on recursion"

Claude launches the UI and prints a `http://127.0.0.1:PORT` link. Open it and go.

## Security

- Server binds to **loopback only** (`127.0.0.1`). Use SSH forwarding remotely.
- It **never executes user code**; tests run only when Claude explicitly runs them.
- File writes are **path-traversal guarded** to the session workspace.
- Progress is stored **locally** under `~/.claude/codetrain/` (profile + session
  summaries) — never uploaded, no secrets.

## Cross-agent

The server + UI are pure `python3` + a browser, and all session updates go through
`app/ctl.sh` and plain files — no Claude-only dependencies. Install by placing the
`codetrain/` folder in your agent's skills directory (Claude Code:
`~/.claude/skills/`; others: see your agent's docs), or run `./install.sh`.

The one Claude-Code-specific nicety is **auto-wake** (the agent reacts the moment you
click Send). On agents without background auto-wake, the flow is identical except you
nudge the agent ("check it") after Send.

## Layout

```bash
codetrain/
  SKILL.md                      # the tutor's instructions (auto-loaded by Claude Code)
  references/session-protocol.md# state schema + the auto-review loop
  app/server.py                 # stdlib server: UI + JSON state API
  app/ctl.sh                    # serve/watch/stop/patch/run control (allowlist-able)
  app/patch.py                  # apply small JSON deltas to session.json (token-cheap)
  app/watch.sh                  # event watcher (wakes Claude on submit/question/end)
  app/checkpoint-hook.sh        # OPTIONAL proactive-checkpoint nudge (off by default)
  app/static/                   # index.html, styles.css, app.js
  app/static/editor.js          # Prism overlay editor (textarea fallback)
  app/static/prism.js           # vendored Prism (highlighting, no CDN)
  app/static/runner.js          # client run dispatcher (timeout, pass/fail)
  app/static/pyodide-worker.js  # Python (WASM) execution worker
  app/static/js-worker.js       # JavaScript sandbox worker
  install.sh
```
