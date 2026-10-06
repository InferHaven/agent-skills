#!/usr/bin/env python3
"""
CodeTrain — add prompt-free permissions (scoped, additive, transparent).

Live tutoring fires the same few commands every turn (the watcher re-arm, the
session-state patch, the optional test run, the learner-profile brief). Without an allow-list, Claude Code prompts for each one,
which is noise during a lesson. This helper merges a SMALL, SCOPED set of rules
into a Claude Code settings file so those — and only those — stop prompting.

It is deliberately NOT a blanket / bypass grant:
  - additive: it never removes or rewrites your rules; the only rules it removes are
    the exact ones an older version of this helper added and no longer needs, listed
    before anything is written,
  - transparent: it prints exactly what it will add before writing,
  - scoped: only this skill's control script + its sandbox/profile paths,
  - idempotent: re-running adds nothing once the rules are present.

Everything outside this set still prompts as usual. This is the right shape for
team / enterprise review: an auditable allow-list, not "skip all permissions".

Usage:
  python3 install-permissions.py [--skill-dir DIR] [--settings FILE]
                                 [--dry-run] [--yes]

Defaults:
  --skill-dir  the installed skill (this script's parent directory's parent)
  --settings   ~/.claude/settings.json
"""
import argparse
import json
import os
import sys


def scoped_rules(skill_dir, home):
    """The complete, minimal allow-list for a prompt-free CodeTrain session."""
    sdir = skill_dir.lstrip("/")
    return [
        # sandbox / serve / watch / patch / run / stop / profile — the entire per-turn loop
        # goes through this one stable entry point (that is why ctl.sh exists).
        "Bash(bash %s/app/ctl.sh:*)" % skill_dir,
        # throwaway sandbox workspace: the tutor writes patch.json + scaffolds here (Claude
        # Code applies Edit rules to every file-writing tool, Write included)
        "Read(//tmp/codetrain-*/**)",
        "Edit(//tmp/codetrain-*/**)",
        # No rule for the learner profile, on purpose: it goes through `ctl.sh profile`, so a
        # direct read of ~/.codetrain asks the learner first.
        # the skill's own files — the tutor reads references/ at session start
        "Read(//%s/**)" % sdir,
        # sandbox creation (ctl.sh sandbox also covers it; kept for a direct mktemp)
        "Bash(mktemp -d /tmp/codetrain-*)",
        # local-code review + teach-on-diff (read-only)
        "Bash(git diff:*)",
    ]


def obsolete_rules(skill_dir, home):
    """Rules older versions of this helper added that this version no longer needs. Claude
    Code ignores Write(...) rules (Edit covers writes), and the profile rules went when the
    profile moved behind `ctl.sh profile`. Matched exactly, so nobody else's rule is touched."""
    cdir = (home.rstrip("/") + "/.codetrain").lstrip("/")
    return [
        "Write(//tmp/codetrain-*/**)",
        "Read(//%s/**)" % cdir,
        "Write(//%s/**)" % cdir,
        "Edit(//%s/**)" % cdir,
    ]


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("--skill-dir", default=os.path.dirname(here),
                    help="installed skill directory (default: this script's skill root)")
    ap.add_argument("--settings", default=os.path.expanduser("~/.claude/settings.json"),
                    help="Claude Code settings file to merge into")
    ap.add_argument("--dry-run", action="store_true", help="show what would change, write nothing")
    ap.add_argument("--yes", action="store_true", help="apply without the interactive confirmation")
    args = ap.parse_args()

    skill_dir = os.path.abspath(os.path.expanduser(args.skill_dir)).rstrip("/")
    settings_path = os.path.abspath(os.path.expanduser(args.settings))
    rules = scoped_rules(skill_dir, os.path.expanduser("~"))

    # Load existing settings. Tolerate absent / empty; refuse to touch broken JSON.
    data = {}
    if os.path.exists(settings_path):
        try:
            with open(settings_path, encoding="utf-8") as f:
                text = f.read().strip()
            data = json.loads(text) if text else {}
        except (json.JSONDecodeError, OSError) as e:
            print("ERROR: %s is not valid JSON (%s); leaving it untouched." % (settings_path, e),
                  file=sys.stderr)
            return 1
    if not isinstance(data, dict):
        print("ERROR: %s top-level is not a JSON object; leaving it untouched." % settings_path,
              file=sys.stderr)
        return 1

    perms = data.setdefault("permissions", {})
    if not isinstance(perms, dict):
        print("ERROR: permissions is not an object; leaving it untouched.", file=sys.stderr)
        return 1
    allow = perms.setdefault("allow", [])
    if not isinstance(allow, list):
        print("ERROR: permissions.allow is not a list; leaving it untouched.", file=sys.stderr)
        return 1

    to_add = [r for r in rules if r not in allow]
    already = [r for r in rules if r in allow]
    to_remove = [r for r in obsolete_rules(skill_dir, os.path.expanduser("~")) if r in allow]

    print("CodeTrain scoped permissions -> %s" % settings_path)
    print("  skill dir: %s" % skill_dir)
    for r in already:
        print("    = %s  (already present)" % r)
    if not to_add and not to_remove:
        print("  nothing to change — sessions are already prompt-free. ✓")
        return 0
    if to_add:
        print("  will add:")
        for r in to_add:
            print("    + %s" % r)
    if to_remove:
        print("  will remove (added by an older version of this helper, no longer needed):")
        for r in to_remove:
            print("    - %s" % r)

    # Detect stale pre-rename rules (from when the skill was "code-trainer").
    # We never auto-remove user rules, but they are dead weight — point them out.
    stale = [r for r in allow if "code-trainer" in r]
    if stale:
        print("  note: these stale pre-rename rules no longer match anything and can be removed:")
        for r in stale:
            print("    ~ %s" % r)

    if args.dry_run:
        print("  (dry-run — nothing written)")
        return 0
    if not args.yes:
        try:
            ans = input("Apply these changes? [y/N] ").strip().lower()
        except EOFError:
            ans = ""
        if not ans.startswith("y"):
            print("  aborted — nothing written.")
            return 0

    allow[:] = [r for r in allow if r not in to_remove] + to_add
    os.makedirs(os.path.dirname(settings_path) or ".", exist_ok=True)
    tmp = settings_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    os.replace(tmp, settings_path)  # atomic
    print("  added %d rule(s), removed %d. Restart Claude Code to pick them up."
          % (len(to_add), len(to_remove)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
