/* CodeTrain — JavaScript runtime worker (classic worker).
   Runs the user's JS in the worker scope (no DOM, no page access), captures
   console output, and calls the entry function for each test case.

   BYTE-IDENTICAL COPY: engine/app/static/js-worker.js. Copy one over the other,
   never hand-merge. */

function jsonSafe(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch (e) { return String(v); }
}

/* This runtime has no module system, and the two ways a learner discovers that are both
   unreadable. `import` is a static parse error, because the code below is compiled as a
   FUNCTION BODY (`new Function`), which the spec parses with the Script goal — so browsers
   answer with "import declarations may only appear at top level of a module" (Firefox),
   "Cannot use import statement outside a module" (V8) or "Unexpected keyword 'import'"
   (Safari). `require(...)` is not a syntax error at all; it throws ReferenceError when the
   factory runs. Neither tells anyone what to do instead.

   This matches on the THROWN ERROR, never by scanning the source. Scanning would flag a
   string literal, a comment, `important`, `requireAuth(...)` or a property named `.import`
   and refuse to run code that is perfectly fine. Rewriting an error that already happened
   cannot produce a false positive, because there was nothing valid to break. */
var NO_MODULES =
  "This runtime has no module system: import, export and require() are not available, and "
  + "there is no package registry to load from. Everything you need is already in the "
  + "JavaScript language itself.";

function explainModuleError(err, code) {
  if (!err || !err.name) return null;
  var msg = String(err.message || "");
  if (err.name === "SyntaxError") {
    // Every engine names the offending keyword in the message. The source check is a
    // fallback for a wording we have not seen, anchored to a line-leading declaration so a
    // string containing the word cannot match.
    if (/\b(import|export)\b/.test(msg)) return NO_MODULES;
    if (/^\s*(import|export)[\s{*]/m.test(String(code || ""))) return NO_MODULES;
    return null;
  }
  if (err.name === "ReferenceError" && /\brequire\b/.test(msg)) return NO_MODULES;
  return null;
}

/* Concise message, not the worker's internal stack frames. When the failure is the missing
   module system we lead with the explanation and keep the browser's own wording after it —
   the learner may search for that text, and the tutor reads the whole string. */
function errorText(err, code) {
  var raw = String((err && err.name) ? err.name + ": " + err.message : err);
  var hint = explainModuleError(err, code);
  return hint ? hint + "\n\n" + raw : raw;
}

self.onmessage = (e) => {
  const { id, code, entry, cases } = e.data;
  const reply = (msg) => self.postMessage(Object.assign({ id }, msg));
  let out = "";
  const log = (...a) => { out += a.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ") + "\n"; };
  const sandboxConsole = { log, info: log, warn: log, error: log, debug: log };

  try {
    // Define the user's code in an isolated function scope, then hand back the
    // entry symbol if it exists. `entry` is a validated identifier (see runner).
    const factory = new Function("console", `${code}\n;return (typeof ${entry || "undefined"} !== "undefined") ? ${entry || "undefined"} : undefined;`);
    const entryFn = factory(sandboxConsole);

    let resultCases = [];
    if (entry && cases && cases.length) {
      resultCases = cases.map((c) => {
        try {
          const got = entryFn.apply(null, c.args || []);
          return { name: c.name, ok: true, got: jsonSafe(got), error: null };
        } catch (err) {
          return { name: c.name, ok: false, error: errorText(err, code) };
        }
      });
    }
    reply({ result: { stdout: out, stderr: "", cases: resultCases } });
  } catch (err) {
    reply({ result: { stdout: out, stderr: errorText(err, code), cases: [] } });
  }
};
