/* CodeTrain — JavaScript runtime worker (classic worker).
   Runs the user's JS in the worker scope (no DOM, no page access), captures
   console output, and calls the entry function for each test case. */

function jsonSafe(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch (e) { return String(v); }
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
          return { name: c.name, ok: false, error: String(err) };
        }
      });
    }
    reply({ result: { stdout: out, stderr: "", cases: resultCases } });
  } catch (err) {
    // show the concise message, not the worker's internal stack frames
    reply({ result: { stdout: out, stderr: String((err && err.name ? err.name + ": " + err.message : err)), cases: [] } });
  }
};
