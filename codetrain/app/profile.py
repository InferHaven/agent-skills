#!/usr/bin/env python3
"""
CodeTrain — the learner profile, kept private by default.

The tutor never reads or edits ~/.codetrain itself. It asks this script for a short brief
at the start of a lesson and hands it one small delta at the end; everything else in the
profile (strengths, notes, gaps that are not due, past lesson summaries) stays on disk.

  profile.py brief [--full] [--today YYYY-MM-DD]
      Print the brief as one JSON object: returning, level, languages, sessions, streak,
      concepts, last_session, latest_goal, due_gaps (oldest first) and counts of what was
      left out. --full prints the whole profile, for when the learner asks to share it.

  profile.py update <delta.json> [--today YYYY-MM-DD]
      Apply an end-of-lesson delta, then delete the delta file:
        {"title": "...", "slug": "...", "level": "...", "language": "python",
         "goal": "...", "learned": ["..."],
         "reviewed": [{"concept": "...", "result": "solid|shaky", "lang": "..."}],
         "new_gaps": [{"concept": "...", "lang": "..."}], "summary_md": "..."}
      Updates totals and the streak, reschedules reviewed gaps (SM-2-lite, the rules in
      references/spaced-repetition.md), logs new gaps, and appends history/<date>-<slug>.md.
      Prints one short line, never the profile.

Standard library only. Data lives in $CODETRAIN_HOME, default ~/.codetrain.
"""
import datetime as dt
import json
import os
import re
import sys
import tempfile

GAP_CAP = 12
GOAL_CAP = 5
DUE_SHOWN = 5
MASTERED_INTERVAL = 21


def home():
    return os.environ.get("CODETRAIN_HOME") or os.path.join(os.path.expanduser("~"), ".codetrain")


def today(args):
    if "--today" in args:
        return dt.date.fromisoformat(args[args.index("--today") + 1])
    return dt.datetime.now(dt.timezone.utc).date()


def load():
    try:
        with open(os.path.join(home(), "profile.json"), encoding="utf-8") as f:
            prof = json.load(f)
        return prof if isinstance(prof, dict) else {}
    except (OSError, ValueError):
        return {}


def save(prof):
    os.makedirs(home(), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=home(), prefix=".profile-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(prof, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, os.path.join(home(), "profile.json"))


def norm(concept):
    return " ".join(str(concept or "").lower().split())


def gaps_of(prof, day):
    """The gaps as objects; a bare string (the old form) means due now, no history."""
    out = []
    for g in prof.get("gaps") or []:
        if isinstance(g, str):
            g = {"concept": g}
        if not isinstance(g, dict) or not norm(g.get("concept")):
            continue
        g = dict(g)
        g.setdefault("interval_days", 1)
        g.setdefault("ease", 2.0)
        g.setdefault("due", day.isoformat())
        out.append(g)
    return out


def is_due(gap, day):
    try:
        return dt.date.fromisoformat(str(gap.get("due"))[:10]) <= day
    except ValueError:
        return True


def count_history():
    try:
        return len([n for n in os.listdir(os.path.join(home(), "history")) if n.endswith(".md")])
    except OSError:
        return 0


def brief(args):
    day = today(args)
    prof = load()
    if "--full" in args:
        print(json.dumps(prof, indent=2, ensure_ascii=False))
        return 0
    gaps = gaps_of(prof, day)
    due = sorted((g for g in gaps if is_due(g, day)), key=lambda g: str(g.get("due")))
    goals = [g for g in prof.get("goals") or [] if isinstance(g, str) and g.strip()]
    out = {
        "returning": bool(prof),
        "level": prof.get("level"),
        "languages": prof.get("languages") or [],
        "sessions": prof.get("sessions") or 0,
        "streak": prof.get("streak") or 0,
        "concepts": prof.get("concepts") or 0,
        "last_session": prof.get("last_session"),
        "latest_goal": goals[-1] if goals else None,
        "due_gaps": [{"concept": g["concept"], "lang": g.get("lang"), "due": g.get("due")}
                     for g in due[:DUE_SHOWN]],
        "due_count": len(due),
        "not_shared": {
            "strengths": len(prof.get("strengths") or []),
            "notes": bool(prof.get("notes")),
            "other_gaps": len(gaps) - len(due),
            "older_goals": max(0, len(goals) - 1),
            "history_files": count_history(),
        },
    }
    print(json.dumps(out, ensure_ascii=False))
    return 0


def slugify(text):
    s = re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")
    return (s[:48].rstrip("-")) or "lesson"


def update(args):
    if len(args) < 2:
        print("usage: profile.py update <delta.json> [--today YYYY-MM-DD]", file=sys.stderr)
        return 2
    path, day = args[1], today(args)
    try:
        with open(path, encoding="utf-8") as f:
            delta = json.load(f)
    except (OSError, ValueError) as e:
        print("profile-update: cannot read %s (%s)" % (path, e), file=sys.stderr)
        return 1
    if not isinstance(delta, dict):
        print("profile-update: the delta must be a JSON object", file=sys.stderr)
        return 1

    prof = load()
    iso = day.isoformat()
    last = prof.get("last_session")
    if last == iso:
        streak = prof.get("streak") or 1
    elif last == (day - dt.timedelta(days=1)).isoformat():
        streak = (prof.get("streak") or 0) + 1
    else:
        streak = 1
    learned = [str(c) for c in delta.get("learned") or [] if str(c).strip()]
    prof["sessions"] = (prof.get("sessions") or 0) + 1
    prof["concepts"] = (prof.get("concepts") or 0) + len(learned)
    prof["streak"] = streak
    prof["last_session"] = iso
    if delta.get("level"):
        prof["level"] = str(delta["level"])
    lang = str(delta.get("language") or "").strip().lower()
    if lang and lang not in (prof.get("languages") or []):
        prof["languages"] = (prof.get("languages") or []) + [lang]
    goal = str(delta.get("goal") or "").strip()
    if goal:
        goals = [g for g in prof.get("goals") or [] if g != goal] + [goal]
        prof["goals"] = goals[-GOAL_CAP:]

    gaps = gaps_of(prof, day)
    by_key = {norm(g["concept"]): g for g in gaps}
    strengths = list(prof.get("strengths") or [])
    tomorrow = (day + dt.timedelta(days=1)).isoformat()
    moved = mastered = 0
    for r in delta.get("reviewed") or []:
        if not isinstance(r, dict) or not norm(r.get("concept")):
            continue
        g = by_key.get(norm(r["concept"]))
        if g is None:
            continue
        moved += 1
        if str(r.get("result")).lower() == "solid":
            if float(g["interval_days"]) >= MASTERED_INTERVAL:
                del by_key[norm(r["concept"])]
                if g["concept"] not in strengths:
                    strengths.append(g["concept"])
                mastered += 1
                continue
            g["ease"] = round(min(2.6, float(g["ease"]) + 0.15), 2)
            g["interval_days"] = max(1, round(float(g["interval_days"]) * g["ease"]))
            g["due"] = (day + dt.timedelta(days=g["interval_days"])).isoformat()
        else:
            g["ease"] = round(max(1.3, float(g["ease"]) - 0.2), 2)
            g["interval_days"] = 1
            g["due"] = tomorrow
        g["last_seen"] = iso
    added = 0
    for n in delta.get("new_gaps") or []:
        if isinstance(n, str):
            n = {"concept": n}
        if not isinstance(n, dict) or not norm(n.get("concept")):
            continue
        key = norm(n["concept"])
        if key in by_key:
            g = by_key[key]
            g["ease"] = round(max(1.3, float(g["ease"]) - 0.2), 2)
            g["interval_days"], g["due"], g["last_seen"] = 1, tomorrow, iso
            continue
        by_key[key] = {"concept": str(n["concept"]).strip(), "lang": n.get("lang") or lang or None,
                       "due": tomorrow, "interval_days": 1, "ease": 2.0, "last_seen": iso}
        added += 1
    kept = sorted(by_key.values(), key=lambda g: str(g.get("last_seen") or ""), reverse=True)
    prof["gaps"] = kept[:GAP_CAP]
    prof["strengths"] = strengths
    save(prof)

    title = str(delta.get("title") or "CodeTrain lesson").strip()
    hdir = os.path.join(home(), "history")
    os.makedirs(hdir, exist_ok=True)
    base = "%s-%s" % (iso, slugify(delta.get("slug") or title))
    name, i = base + ".md", 2
    while os.path.exists(os.path.join(hdir, name)):
        name, i = "%s-%d.md" % (base, i), i + 1
    lines = ["# " + title, "", "Date: " + iso]
    if learned:
        lines += ["", "## Learned"] + ["- " + c for c in learned]
    if str(delta.get("summary_md") or "").strip():
        lines += ["", "## Recap", str(delta["summary_md"]).strip()]
    with open(os.path.join(hdir, name), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    try:
        os.remove(path)
    except OSError:
        pass
    print("profile updated: sessions %d, streak %d, %d gap(s) rescheduled, %d mastered, %d new; "
          "history/%s" % (prof["sessions"], streak, moved - mastered, mastered, added, name))
    return 0


def main(argv):
    if argv and argv[0] == "brief":
        return brief(argv)
    if argv and argv[0] == "update":
        return update(argv)
    print(__doc__.strip().splitlines()[0], file=sys.stderr)
    print("usage: profile.py brief [--full] | update <delta.json>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
