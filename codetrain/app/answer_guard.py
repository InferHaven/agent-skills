"""
CodeTrain — the answer guard: the second lock behind the "never the answer" rule.

SKILL.md tells the tutor never to put the learner's solution into the lesson. This module
checks that in code before the page shows anything: a code span in the feedback or in a hint
that writes out a step the learner has still to write is held back, and the page shows it
only behind a click ("Show it anyway"), so nothing is deleted and nothing is hidden for good.
The learner can always ask their agent directly in its own chat.

Ported from the guard in CodeTrain's hosted tutor (the same rules, thresholds and word lists),
so every CodeTrain tutor behaves the same way; a test in CodeTrain runs shared cases through
both copies. Deliberately a heuristic: the second lock, not a proof.

The rule: a span is held when it shares two or more of a step's own names. A step's names are
the identifiers its `task_md` marks as code, plus, for the step the learner is on, the names in
their own code. Syntax words (`const`, `return`, ...) never count, one-character names are
noise, escapes split words, anything already in front of the learner (their code, the task and
the step's text) is always allowed, and a shape with the answer taken out (`<your check>`,
`...`, `___`) stays when what is left no longer writes the step out.
"""
import re

_IDENT = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")
_BACKTICKED = re.compile(r"`([^`\n]{2,200})`")
_FENCE_RE = re.compile(r"```([^\n]*)\n(.*?)(?:```|\Z)", re.DOTALL)
_PLACEHOLDER_RE = re.compile(r"<[^>\n]{1,60}>|\.\.\.|…|___+")
_MIN_IDENT_LEN = 2
_ESCAPE_RE = re.compile(r"\\.")
_SYNTAX_WORDS = frozenset("""
and as assert async await break case catch class const continue def default del do done elif
else elsif end esac except export extends extern false fi final finally fn for foreach from func
function global goto if implements import in instanceof interface is lambda let local loop match
module mut new nil none nonlocal not null of or pass private protected public raise readonly
return select self static struct super switch then this throw throws true try type typeof union
unless until use var void when while with yield
""".split())

FEEDBACK_HELD_NOTE = "**The tutor hid some code here. It could be a spoiler.**"


def _norm_code(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def _seen_haystack(step, submitted_code=None, run_output=None):
    """Everything already in front of the learner, as one searchable string."""
    step = step or {}
    parts = (submitted_code, run_output, step.get("task_md"), step.get("body_md"))
    return _norm_code("\n".join(str(p or "") for p in parts))


def _names(span):
    return {t for t in _IDENT.findall(span) if len(t) >= _MIN_IDENT_LEN}


def _is_pasteable(span):
    """Two or more real names is an expression; one is the thing being taught."""
    return len(_names(span)) >= 2


def _lesson_names(span):
    return {t.lower() for t in _IDENT.findall(_ESCAPE_RE.sub(" ", str(span or "")))
            if len(t) >= _MIN_IDENT_LEN and t.lower() not in _SYNTAX_WORDS}


def answer_names(steps, submitted_code=None):
    """Per step still to write, the names it invented. `None` (no step known) and `[]` (nothing
    left to protect) are different answers and must never be collapsed."""
    if steps is None:
        return None
    out = []
    for i, step in enumerate(steps):
        names = set()
        for span in _BACKTICKED.findall(str((step or {}).get("task_md") or "")):
            names |= _lesson_names(span)
        if i == 0 and submitted_code:
            names |= _lesson_names(submitted_code)
        out.append(names)
    return out


def _reproduces(span, names):
    if names is None:
        return _is_pasteable(span)
    found = _lesson_names(span)
    return any(len(found & step) >= 2 for step in names)


def span_allowed(span, haystack, names):
    """Whether one code span may reach the learner."""
    clean = _norm_code(span)
    if not clean:
        return True
    if clean in haystack:
        return True
    holed = _PLACEHOLDER_RE.sub(" ", clean)
    if holed != clean and not _reproduces(holed, names):
        return True
    return not _reproduces(clean, names)


_UNSET = object()


def sanitize_feedback(md, step=None, submitted_code=None, run_output=None, names=_UNSET):
    """`(markdown, held)`: the text with any span that writes a step out held back, and the
    spans taken. Fences keep only the lines that may stay; an inline span becomes `…`."""
    text = str(md or "")
    if not text.strip():
        return text, []
    if names is _UNSET:
        names = answer_names([step] if step else None, submitted_code)
    hay = _seen_haystack(step, submitted_code, run_output)
    held = []

    chunks, pos = [], 0
    for m in _FENCE_RE.finditer(text):
        chunks.append((None, text[pos:m.start()]))
        chunks.append((m.group(1), m.group(2)))
        pos = m.end()
    chunks.append((None, text[pos:]))

    out = []
    for lang, chunk in chunks:
        if lang is None:
            def _inline(mm):
                if span_allowed(mm.group(1), hay, names):
                    return mm.group(0)
                held.append(mm.group(1).strip())
                return "`…`"
            out.append(_BACKTICKED.sub(_inline, chunk))
            continue
        lines = chunk.splitlines()
        kept = [ln for ln in lines if span_allowed(ln, hay, names)]
        if len(kept) != len(lines):
            held.extend(ln.strip() for ln in lines if ln not in kept and ln.strip())
        body = "\n".join(kept).strip("\n")
        out.append("```" + lang + "\n" + body + "\n```" if body.strip() else "")

    result = re.sub(r"\n{3,}", "\n\n", "".join(out)).strip()
    if held:
        result = (result + "\n\n" + FEEDBACK_HELD_NOTE).strip()
    return result, held


def guard_state(state):
    """The session as the page may see it. The file on disk is left as the tutor wrote it.

    The feedback is measured against the step the learner is on and every step after it: a step
    already passed is written and in their editor, so a closing note about it is fair. Each
    hint is measured against its own step. Held spans travel as `feedback.held` and
    `step.hints_held[i]`, for the page to show behind a click.
    """
    if not isinstance(state, dict):
        return state
    out = dict(state)
    steps = state.get("steps") if isinstance(state.get("steps"), list) and state.get("steps") else None
    try:
        idx = int((state.get("progress") or {}).get("step") or 1)
    except (TypeError, ValueError):
        idx = 1
    idx = max(1, idx)
    code = str((state.get("submission") or {}).get("code") or "")
    current = steps[idx - 1] if steps and idx <= len(steps) else None
    ahead = steps[idx - 1:] if steps else None

    fb = state.get("feedback")
    if isinstance(fb, dict) and str(fb.get("md") or "").strip():
        md, held = sanitize_feedback(fb["md"], step=current, submitted_code=code,
                                     names=answer_names(ahead, code))
        fb = dict(fb, md=md)
        if held:
            fb["held"] = held
        out["feedback"] = fb

    if steps:
        guarded = []
        for i, st in enumerate(steps):
            hints = st.get("hints") if isinstance(st, dict) else None
            if i < idx - 1 or not isinstance(hints, list):
                guarded.append(st)
                continue
            mine = code if i == idx - 1 else None
            names = answer_names([st], mine)
            new_hints, hints_held = [], []
            for h in hints:
                hm, hh = sanitize_feedback(h, step=st, submitted_code=mine, names=names)
                new_hints.append(hm)
                hints_held.append(hh)
            st = dict(st, hints=new_hints)
            if any(hints_held):
                st["hints_held"] = hints_held
            guarded.append(st)
        out["steps"] = guarded
    return out
