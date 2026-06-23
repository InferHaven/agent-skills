# Review & spaced repetition (how the tutor schedules revisits)

CodeTrain remembers what a learner struggled with and resurfaces it at widening
intervals — so a weak concept gets re-practised right before it would fade, then
less and less often as it sticks. You (the tutor) compute all of this **by hand**
from the small `profile.json`; there is no extra code or library.

## The gap record

Each recurring trouble spot lives in `profile.json`'s `gaps` array as an object:

```jsonc
{
  "concept": "closures capture by reference",  // short + specific
  "lang": "javascript",
  "due": "2026-06-25",        // ISO date — resurface on/after this day
  "interval_days": 2,          // current spacing
  "ease": 2.0,                 // difficulty multiplier, 1.3 (hard) … 2.6 (easy)
  "last_seen": "2026-06-23"
}
```

A bare **string** in `gaps` (legacy) means "due now, no history": treat it as a gap
with `interval_days: 1`, `ease: 2.0`, `due` = today, and upgrade it to the object
form the next time you touch it. Keep `gaps` small (cap ~12 — drop the oldest that's
been mastered).

## Scheduling (SM-2-lite — trivial mental math)

"Due" means `due` ≤ today (UTC date). After a review, update the gap:

- **New gap** (a concept the learner just struggled with): add it with
  `interval_days: 1`, `ease: 2.0`, `due` = tomorrow, `last_seen` = today.
- **Reviewed & solid** (passed the drill with ≤1 hint and could explain it back):
  `ease = min(2.6, ease + 0.15)`;
  `interval_days = max(1, round(interval_days × ease))`;
  `due` = today + interval_days; `last_seen` = today.
- **Reviewed & shaky** (needed several hints, retried, or couldn't explain it):
  `ease = max(1.3, ease − 0.2)`; `interval_days = 1`; `due` = tomorrow;
  `last_seen` = today.
- **Mastered** (came back solid with `interval_days` already ≥ ~21): drop it from
  `gaps` and add the concept to `strengths`.

## Review / drill mode

Triggered by "review my weak spots", "drill me", "spaced review", "what should I
revisit" — or offered at session start when gaps are due.

1. Read `profile.json`; compute the **due** gaps (`due` ≤ today).
2. Pick the 1–3 most-overdue concepts (oldest `due` first). Author a short
   **sandbox** session: one tiny step per concept, each a **fresh** micro-drill on
   that idea (a new angle — not a replay of the old exercise). Set the `profile`
   welcome to name the count ("2 topics are due — quick drill?").
3. Run the normal steps / patch / run loop. After each drill, judge solid vs shaky.
4. At teardown, **reschedule** each reviewed gap per the rule above, **log** any new
   gaps that surfaced, and save the profile as usual.

If gaps are due but the user asked for a *specific* lesson, don't hijack it: either
weave one due concept in as the warm-up first step, or mention it once ("heads-up:
`closures` is due for review — say 'drill me' anytime") and continue. Never nag;
offer at most once per session.

## Worked example

`{"concept":"list vs generator","lang":"python","due":"2026-06-23","interval_days":3,"ease":2.0,"last_seen":"2026-06-20"}`
is due today.

- Learner nails the drill with no hints → `ease 2.0 → 2.15`,
  `interval_days = round(3 × 2.15) = 6`, `due = 2026-06-29`. Next revisit a week out.
- Learner struggles → `ease 2.0 → 1.8`, `interval_days = 1`, `due = 2026-06-24`
  (tomorrow). It comes back fast until it sticks.
