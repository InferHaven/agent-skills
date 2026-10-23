/* CodeTrain — has the local lesson server gone away?

   The page polls `/api/state`. When the CLI finishes a lesson (or is stopped with Ctrl-C), and
   when the open skill's server exits on its own after a finished lesson, the server simply stops
   answering. Every failed poll used to be swallowed, so the page froze on whatever it last showed
   ("Ending…" on the End button, a pulsing "tutor is listening"), and nothing said the lesson was
   over. A few CONSECUTIVE refused connections mean the server is gone; one is a hiccup.

   Only a refused connection counts. A server that answers with an error is still there, and
   calling that "ended" would tell somebody mid-lesson to close a tab that still works.

   Pure on purpose, so agent/tests/liveness.test.mjs can run it without a browser. */

export const FAILS_TO_END = 3;

export function createLiveness(limit = FAILS_TO_END) {
  let fails = 0;
  let ended = false;
  return {
    /* The server answered. Resets the count; nothing comes back once ended. */
    ok() {
      if (!ended) fails = 0;
    },
    /* A poll could not connect. True exactly once: on the failure that ends it. */
    fail() {
      if (ended) return false;
      fails += 1;
      if (fails >= limit) {
        ended = true;
        return true;
      }
      return false;
    },
    get ended() { return ended; },
  };
}

/* Which ending to describe: a finished lesson, or a server that stopped part way through. A state
   is finished when its phase is "done", or when it says so (`finished`): an onboarding journey's
   last screen keeps the step view, so its phase stays "active". */
export function isFinished(state) {
  return !!state && (state.phase === "done" || state.finished === true);
}
export function endingFor(finished) {
  return finished ? "done" : "stopped";
}
