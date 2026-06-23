/* CodeTrain — client-side runner.
   Dispatches code to a per-language web worker (Python via Pyodide, JS via a
   sandboxed worker), with a per-run timeout and lazy worker creation. Computes
   per-case pass/fail by deep-equality against each case's `expected`.

   The server never executes code; this all runs in the browser. Languages with
   no worker (bash, etc.) report unavailable so the UI falls back to Claude. */

const RUN_TIMEOUT_MS = 12000;
const IDENT = /^[A-Za-z_$][\w$]*$/;

const WORKER_FILE = { python: "pyodide-worker.js", javascript: "js-worker.js", js: "js-worker.js" };
const pool = {};        // lang -> Worker
let reqId = 0;
const pending = {};     // id -> {resolve, reject, timer, onStatus}

const SHELL = new Set(["bash", "sh", "shell"]);
let _bashOk = null;       // server-side container runner availability (probed once)

export function runtimeLang(lang) {
  const l = (lang || "").toLowerCase();
  if (l === "python" || l === "py") return "python";
  if (l === "javascript" || l === "js" || l === "node") return "javascript";
  return null;            // bash handled server-side; others -> Claude-run
}
export async function probeBash() {
  try { const r = await fetch("/api/runtime", { cache: "no-store" }); _bashOk = !!(await r.json()).bash; }
  catch (e) { _bashOk = false; }
  return _bashOk;
}
export function runtimeAvailable(lang) {
  if (runtimeLang(lang)) return true;
  if (SHELL.has((lang || "").toLowerCase())) return !!_bashOk;
  return false;
}

function getWorker(lang) {
  if (pool[lang]) return pool[lang];
  const w = new Worker(WORKER_FILE[lang]);
  w.onmessage = (e) => {
    const { id, type, msg, result } = e.data || {};
    const p = pending[id];
    if (!p) return;
    if (type === "status") { if (p.onStatus) p.onStatus(msg); return; }
    clearTimeout(p.timer);
    delete pending[id];
    p.resolve(result);
  };
  w.onerror = (err) => {
    // a worker-level failure (e.g. CDN blocked) rejects all in-flight calls
    Object.keys(pending).forEach((id) => {
      const p = pending[id];
      clearTimeout(p.timer); delete pending[id];
      p.reject(new Error(err.message || "worker error"));
    });
    try { w.terminate(); } catch (e) {}
    delete pool[lang];
  };
  pool[lang] = w;
  return w;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/* runCode({lang, code, entry, cases, onStatus}) ->
   {stdout, stderr, cases:[{name, passed, got, expected, error}]} */
export async function runCode({ lang, code, entry, cases, onStatus }) {
  if (SHELL.has((lang || "").toLowerCase())) {            // real bash via sandboxed container (server)
    if (onStatus) onStatus("running in sandbox container…");
    const r = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang, code }) });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    const tail = j.exit ? "\n[exit " + j.exit + "]" : "";
    return { stdout: (j.stdout || "") + tail, stderr: j.stderr || "", cases: [] };
  }
  const rl = runtimeLang(lang);
  if (!rl) throw new Error("no client runtime for " + lang);
  if (entry && !IDENT.test(entry)) throw new Error("invalid entry name");
  const w = getWorker(rl);
  const id = ++reqId;

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      delete pending[id];
      try { w.terminate(); } catch (e) {}
      delete pool[rl];               // recreate next time (drops a hung loop)
      reject(new Error("timed out (possible infinite loop)"));
    }, RUN_TIMEOUT_MS);
    pending[id] = { resolve, reject, timer, onStatus };
    w.postMessage({ id, code, entry, cases: (cases || []).map((c) => ({ name: c.name, args: c.args || [] })) });
  });

  const merged = (result.cases || []).map((r, i) => {
    const expected = (cases && cases[i]) ? cases[i].expected : undefined;
    return {
      name: r.name || ("case " + (i + 1)),
      got: r.got,
      expected,
      error: r.error || null,
      passed: r.ok && deepEqual(r.got, expected),
    };
  });
  return { stdout: result.stdout || "", stderr: result.stderr || "", cases: merged };
}
