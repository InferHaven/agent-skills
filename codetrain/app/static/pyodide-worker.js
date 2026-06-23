/* CodeTrain — Python runtime worker (classic worker).
   Loads Pyodide (WASM) from CDN once, runs the user's code + optional test cases,
   and posts back stdout/stderr and per-case results. Runs in a worker sandbox:
   no DOM, no access to the page. This is the user's own code in their browser. */

const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
let pyReady = null;

// Strip Pyodide's internal frames so the user sees only their own error.
function cleanTrace(msg) {
  const lines = String(msg).split("\n");
  const i = lines.findIndex((l) => l.includes('File "<exec>"') || l.includes('File "<unknown>"'));
  const kept = i >= 0 ? ["Traceback (most recent call last):", ...lines.slice(i)] : lines;
  return kept.join("\n")
    .replace(/File "<exec>"/g, 'File "your code"')
    .replace(/File "<unknown>"/g, 'File "your code"')
    .trim();
}

function ready(post) {
  if (!pyReady) {
    post({ type: "status", msg: "loading Python runtime…" });
    importScripts(PYODIDE_CDN + "pyodide.js");
    pyReady = loadPyodide({ indexURL: PYODIDE_CDN });
  }
  return pyReady;
}

self.onmessage = async (e) => {
  const { id, code, entry, cases } = e.data;
  const reply = (msg) => self.postMessage(Object.assign({ id }, msg));
  let out = "";
  try {
    const py = await ready(reply);
    py.setStdout({ batched: (s) => { out += s + "\n"; } });
    py.setStderr({ batched: (s) => { out += s + "\n"; } });

    let topErr = null;
    try {
      await py.runPythonAsync(code);
    } catch (err) {
      topErr = cleanTrace(String((err && err.message) || err));
    }

    let resultCases = [];
    if (!topErr && entry && cases && cases.length) {
      py.globals.set("__cases_json", JSON.stringify(cases));
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
      const raw = await py.runPythonAsync(harness);
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
  }
};
