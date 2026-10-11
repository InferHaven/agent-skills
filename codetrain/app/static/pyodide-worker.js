/* CodeTrain — Python runtime worker (classic worker).
   Loads Pyodide (WASM) from CDN once, runs the user's code + optional test cases,
   and posts back stdout/stderr and per-case results. Runs in a worker sandbox:
   no DOM, no access to the page. This is the user's own code in their browser. */

const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
let pyReady = null;

// Show the learner only their own frames + the final error. Keep every "your code"
// frame (so user-defined functions still show), collapse runs of library/internal frames
// (stdlib zip, site-packages, frozen importlib) into one note, and keep the error text.
function cleanTrace(msg) {
  const raw = String(msg).split("\n").map((l) =>
    l.replace(/File "<exec>"/g, 'File "your code"').replace(/File "<unknown>"/g, 'File "your code"'));
  const start = raw.findIndex((l) => l.includes('File "your code"'));
  const lines = start >= 0 ? raw.slice(start) : raw;
  const out = start >= 0 ? ["Traceback (most recent call last):"] : [];
  let collapsed = false;
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    const isFrame = /^\s*File "/.test(l);
    const isLib = isFrame && /File "(\/lib\/|[^"]*\.zip|[^"]*site-packages|<frozen)/.test(l);
    if (isLib) {
      if (!collapsed) { out.push("  … (inside a library)"); collapsed = true; }
      // skip the frame's source line too (indented, not a File line, not the exception)
      const nxt = lines[k + 1];
      if (nxt && !/^\s*File "/.test(nxt) && !/^\S+(Error|Exception|Warning):/.test(nxt.trim())) k++;
      continue;
    }
    collapsed = false;
    out.push(l);
  }
  return out.join("\n").trim();
}

function ready(post) {
  if (!pyReady) {
    post({ type: "status", msg: "loading Python runtime…" });
    importScripts(PYODIDE_CDN + "pyodide.js");
    pyReady = loadPyodide({ indexURL: PYODIDE_CDN });
  }
  return pyReady;
}

// First module name from a "No module named 'x'" error, if any.
function missingModule(msg) {
  const m = /No module named '([\w.]+)'/.exec(String(msg));
  return m ? m[1].split(".")[0] : null;
}

// Run the learner's code, transparently fetching any libraries they import:
// loadPackagesFromImports covers everything bundled with Pyodide (requests, numpy,
// pandas, …); if a pure-Python package is still missing, fall back to micropip.
async function runWithAutoImports(py, ns, code, post) {
  try { post({ type: "status", msg: "loading libraries…" }); await py.loadPackagesFromImports(code); }
  catch (e) { /* best effort — running will surface a real import error below */ }
  try {
    await py.runPythonAsync(code, { globals: ns });
    return null;
  } catch (err) {
    const raw = String((err && err.message) || err);
    const mod = missingModule(raw);
    if (!mod) return cleanTrace(raw);
    try {
      post({ type: "status", msg: `installing ${mod}…` });
      await py.loadPackage("micropip");
      const micropip = py.pyimport("micropip");
      await micropip.install(mod);
      await py.runPythonAsync(code, { globals: ns });
      return null;
    } catch (err2) {
      return cleanTrace(String((err2 && err2.message) || err2));
    }
  }
}

// ONE NAMESPACE PER RUN, AND THIS IS LOAD-BEARING.
//
// `runPythonAsync(code)` with no `globals` executes in `pyodide.globals`, which is ONE namespace
// for the whole life of the worker: every Run, every step, every lesson in that tab. Anything a
// learner binds leaks into every later run, BUILTINS INCLUDED, and the traceback then points at
// code that is correct.
//
// Measured: a learner whose earlier run left `dict` bound to a dict INSTANCE wrote a textbook
// `class CaseInsensitiveDict(dict):` and got `TypeError: dict expected at most 1 argument, got 3`
// on line 1. Python resolves a class's metaclass from `type(base)`, so with a dict instance as
// the base the metaclass IS `dict`, and `__build_class__` calls `dict(name, bases, namespace)`.
// Three arguments. Nothing in the file they were looking at could explain it, and the tutor
// reviewing the turn guessed -- reasonably and wrongly -- that we were running a different file.
//
// So each message gets a throwaway namespace. Built in Python rather than with
// `pyodide.globals.get("dict")()` because it needs `__name__` seeded: a bare dict has none, and
// `if __name__ == "__main__":` would raise NameError instead of being false.
function freshNamespace(py) {
  return py.runPython("dict(__name__='__main__')");
}

// A LAST LINE WITH NO NEWLINE BELONGS TO ITS OWN RUN. The batched handlers hand on a line when its
// newline is written, so a run whose last output was `print(x, end="")` lost that line: it waited
// in Pyodide's buffer and was printed at the start of the NEXT run, in front of output it had
// nothing to do with. Python's own flush() does not reach the batched handler; an fsync of the
// descriptor does (measured on Pyodide 0.26.4, 2026-10-11). It runs in the run's own namespace,
// thrown away after, and a flush that fails never fails the run.
const FLUSH_STREAMS = "import os as __os, sys as __sys\n__sys.stdout.flush()\n__sys.stderr.flush()\n"
  + "__os.fsync(1)\n__os.fsync(2)";
function flushStreams(py, ns) {
  try { py.runPython(FLUSH_STREAMS, { globals: ns }); } catch (e) { /* the run's result stands */ }
}

self.onmessage = async (e) => {
  const { id, code, entry, cases } = e.data;
  const reply = (msg) => self.postMessage(Object.assign({ id }, msg));
  let out = "";
  let ns = null;
  try {
    const py = await ready(reply);
    py.setStdout({ batched: (s) => { out += s + "\n"; } });
    py.setStderr({ batched: (s) => { out += s + "\n"; } });

    ns = freshNamespace(py);
    let topErr = null;
    try {
      topErr = await runWithAutoImports(py, ns, code, reply);
    } catch (err) {
      topErr = cleanTrace(String((err && err.message) || err));
    }
    flushStreams(py, ns);

    let resultCases = [];
    if (!topErr && entry && cases && cases.length) {
      ns.set("__cases_json", JSON.stringify(cases));
      const harness = `
import json as __json
__cases = __json.loads(__cases_json)
__results = []
for __c in __cases:
    try:
        __got = ${entry}(*list(__c.get("args", [])))
        __results.append({"name": __c.get("name"), "ok": True,
                          "got_json": __json.dumps(__got, default=str, sort_keys=True)})
    except Exception as __e:
        __results.append({"name": __c.get("name"), "ok": False, "error": repr(__e)})
__json.dumps(__results)
`;
      const raw = await py.runPythonAsync(harness, { globals: ns });
      flushStreams(py, ns);
      resultCases = JSON.parse(raw).map((r) => ({
        name: r.name,
        ok: r.ok,
        error: r.error || null,
        got: r.ok ? JSON.parse(r.got_json) : undefined,
      }));
    }
    reply({ result: { stdout: out, stderr: topErr || "", cases: resultCases } });
  } catch (err) {
    reply({ result: { stdout: out, stderr: String((err && err.stack) || err), cases: [] } });
  } finally {
    // A PyProxy is not garbage collected for us; without this every Run leaks one for the life
    // of the tab.
    if (ns) { try { ns.destroy(); } catch (e) { /* already gone */ } }
  }
};
