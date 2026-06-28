/* CodeTrain — front-end (ES module).
   Idempotent rendering (no flicker), CodeMirror/textarea editor, instant
   client-side Run for Python/JS, structured test results, auto-review on Send. */

import { createEditor } from "./editor.js";
import { runCode, runtimeAvailable, runtimeLang, probeBash } from "./runner.js";

const $ = (id) => document.getElementById(id);
const POLL_MS = 1200;

const cache = {
  title: null, statusS: null, badge: null, level: null, goal: null, prog: null,
  learned: null, feedback: null, tests: null, cases: null, view: null, profile: null,
};
let confettiDone = false;
let learnedPrev = [];
let currentState = {};
let editor = null;

let revealedHints = 0;
let starterCode = "";
let editorDirtyStep = null;
let lastSeededStep = null;
const clientResults = {};   // view -> [{name,passed,got,expected,error}]
let lastRun = null;         // {lang,total,passed} attached to next submit
let greenCode = null;       // editor code that last passed ALL client cases

let awaiting = false;
let sentFeedbackSig = null;
let sentView = null;

/* ---------- theme ---------- */
(function initTheme() {
  const saved = localStorage.getItem("tutor-theme");
  const sys = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = saved || sys;
})();
$("theme-toggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("tutor-theme", next);
});

/* ---------- helpers ---------- */
function setText(el, txt) { if (el.textContent !== txt) el.textContent = txt; }
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
function md(src) {
  if (!src) return "";
  let t = esc(src);
  t = t.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _l, c) => `<pre class="code"><code>${c.replace(/\n$/, "")}</code></pre>`);
  t = t.replace(/`([^`]+)`/g, '<code class="ic">$1</code>');
  t = t.replace(/^### (.*)$/gm, "<h4>$1</h4>").replace(/^## (.*)$/gm, "<h3>$1</h3>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(?:^|\n)((?:- .*(?:\n|$))+)/g, (_, block) => {
    const items = block.trim().split("\n").map((l) => `<li>${l.replace(/^- /, "")}</li>`).join("");
    return `\n<ul>${items}</ul>`;
  });
  t = t.split(/\n{2,}/).map((b) => (/^\s*<(ul|pre|h3|h4)/.test(b) ? b : `<p>${b.replace(/\n/g, "<br>")}</p>`)).join("\n");
  return t;
}
function mdInline(src) { return md(src).replace(/^<p>|<\/p>\s*$/g, ""); }
async function post(body) {
  try { await fetch("/api/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch (e) {}
}
function toast(html, ms = 4200) {
  const el = $("toast"); el.innerHTML = html; el.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove("show"), ms);
}
function fireConfetti() {
  const root = $("confetti"); if (!root) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#39aaaa", "#5fc6c6", "#aa3939", "#5cb88a", "#e7eef2"];
  for (let i = 0; i < 90; i++) {
    const p = document.createElement("i");
    p.className = "cpiece";
    p.style.left = Math.random() * 100 + "vw";
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = (Math.random() * 0.5) + "s";
    p.style.animationDuration = (2.2 + Math.random() * 1.8) + "s";
    root.appendChild(p);
    setTimeout(() => p.remove(), 4600);
  }
}
function activeStep(s) {
  const st = s && s.steps;
  if (Array.isArray(st) && st.length) {
    const i = ((s.progress && s.progress.step) || 1) - 1;
    if (i >= 0 && i < st.length) return st[i];
  }
  return (s && s.step) || {};
}
function activeTests(s) { return activeStep(s).tests || (s && s.tests) || {}; }
function currentLang() { const t = activeTests(currentState); return t.lang || activeStep(currentState).lang || "text"; }

/* ---------- submit / lock ---------- */
// Can we verify correctness in the browser for this step? (runtime + cases)
function canVerify() {
  const t = activeTests(currentState);
  return runtimeAvailable(currentLang()) && !!(t.cases && t.cases.length);
}
// Send is the "advance me" action: gated to all-green when verifiable client-side.
// Review my attempt is always available (works on failing code).
function updateSendGate() {
  if (awaiting) return;                       // locked mid-review; leave as-is
  const send = $("send");
  if (!canVerify()) {                         // bash / no cases / offline -> tutor verifies
    send.disabled = false; send.title = "Send your code to the tutor"; return;
  }
  const ok = greenCode !== null && editor && editor.getValue() === greenCode;
  send.disabled = !ok;
  send.title = ok
    ? "All checks pass — send to advance"
    : "Run first — Send unlocks when every check passes. Stuck? Use “Review my attempt”.";
}
function lockSubmit() {
  awaiting = true; sentFeedbackSig = cache.feedback; sentView = cache.view;
  const s = $("send"), r = $("review");
  s.disabled = true; r.disabled = true; s.classList.add("sent"); s.textContent = "Sent — reviewing…";
}
function unlockSubmit() {
  awaiting = false;
  const s = $("send"), r = $("review");
  r.disabled = false; s.classList.remove("sent"); s.textContent = "Send to tutor →";
  updateSendGate();                           // Send re-locks unless still green
}
function submit(reviewRequest) {
  if (awaiting) return;
  lockSubmit();
  post({ type: "submit", code: editor.getValue(), note: $("note").value, client_tests: lastRun, review_request: !!reviewRequest });
  $("note").value = "";
  const greenAll = canVerify() && lastRun && lastRun.total > 0 && lastRun.passed === lastRun.total;
  toast(reviewRequest
    ? "Asked your tutor for a walkthrough — <b>reviewing…</b> (works even on failing code)."
    : greenAll
    ? "All checks pass — sent to your tutor. <b>Reviewing…</b>"
    : "Sent to your tutor — <b>reviewing…</b>");
}
$("send").addEventListener("click", () => submit(false));
$("review").addEventListener("click", () => submit(true));
$("reset").addEventListener("click", () => { editor.setValue(starterCode); editorDirtyStep = null; updateSendGate(); });

/* ---------- ask a question (no code submit) ---------- */
$("ask").addEventListener("click", () => {
  const q = $("note").value.trim();
  if (!q) return toast("Type a question first ☝️", 2200);
  post({ type: "question", text: q, code: editor ? editor.getValue() : "" });
  $("note").value = "";
  toast("Asked your tutor — <b>the answer will appear here</b> shortly.");
});

/* ---------- end session (explicit, two-click so it's never accidental) ---------- */
let endArmed = false, endTimer = null;
$("end-session").addEventListener("click", () => {
  const b = $("end-session");
  if (!endArmed) {
    endArmed = true; b.classList.add("armed"); b.textContent = "Click again to end";
    endTimer = setTimeout(() => { endArmed = false; b.classList.remove("armed"); b.textContent = "End session"; }, 3500);
    return;
  }
  clearTimeout(endTimer); endArmed = false;
  b.classList.remove("armed"); b.disabled = true; b.textContent = "Ending…";
  post({ type: "end" });
  toast("Wrapping up — <b>saving your progress…</b>");
});

/* ---------- progress drawer (local profile + history, on-demand) ---------- */
let prevFocus = null;
function progKeydown(e) { if (e.key === "Escape") closeProgress(); }
async function openProgress() {
  let data = {};
  try { const r = await fetch("/api/profile", { cache: "no-store" }); data = await r.json(); } catch (e) {}
  renderProgress(data);
  $("progress-backdrop").hidden = false;
  $("progress-drawer").hidden = false;
  prevFocus = document.activeElement;
  $("progress-close").focus();
  document.addEventListener("keydown", progKeydown);
}
function closeProgress() {
  $("progress-drawer").hidden = true;
  $("progress-backdrop").hidden = true;
  document.removeEventListener("keydown", progKeydown);
  if (prevFocus && prevFocus.focus) prevFocus.focus();
}
function gapDue(g, today) {
  if (typeof g === "string") return { concept: g, lang: "", due: today, overdue: true };
  const due = g.due || today;
  return { concept: g.concept || "(concept)", lang: g.lang || "", due, overdue: due <= today };
}
function renderProgress(data) {
  const p = (data && data.profile) || {};
  const hist = (data && data.history) || [];
  const today = new Date().toISOString().slice(0, 10);
  if (!Object.keys(p).length && !hist.length) {
    $("progress-body").innerHTML = `<p class="pg-empty">Your progress will appear here after your first session.</p>`;
    return;
  }
  const sec = (title, inner) => `<div class="pg-sec"><h3>${title}</h3>${inner}</div>`;
  const list = (items) => items.length ? `<ul class="pg-list">${items.map((x) => `<li>${x}</li>`).join("")}</ul>` : `<p class="pg-empty">—</p>`;
  const stats = [];
  if (p.streak) stats.push(`🔥 ${esc(p.streak)}-day streak`);
  if (p.sessions != null) stats.push(`${esc(p.sessions)} sessions`);
  if (p.concepts != null) stats.push(`${esc(p.concepts)} concepts`);
  const langs = (p.languages && typeof p.languages === "object")
    ? Object.entries(p.languages).map(([k, v]) => `${esc(k)} · ${esc(v)}`) : [];
  const due = (p.gaps || []).map((g) => gapDue(g, today));
  const dueNow = due.filter((g) => g.overdue).length;
  let html = "";
  if (stats.length) html += `<div class="pg-stats">${stats.map((s) => `<span class="pg-stat">${s}</span>`).join("")}</div>`;
  if (langs.length) html += sec("Languages", list(langs));
  html += sec(`Due for review${dueNow ? ` (${dueNow})` : ""}`, due.length
    ? `<ul class="pg-list">${due.map((g) => `<li class="pg-gap ${g.overdue ? "overdue" : ""}"><span>${esc(g.concept)}${g.lang ? ` <span class="cx">${esc(g.lang)}</span>` : ""}</span><span class="due">${g.overdue ? "due" : esc(g.due)}</span></li>`).join("")}</ul>`
    : `<p class="pg-empty">Nothing due — nice.</p>`);
  if ((p.strengths || []).length) html += sec("Strengths", list(p.strengths.map(esc)));
  if (hist.length) html += sec("Recent sessions",
    `<div class="pg-hist">${hist.map((h) => `<div><div class="h-date">${esc(h.date || "")}</div><div>${esc(h.title || h.slug || "session")}</div></div>`).join("")}</div>`);
  $("progress-body").innerHTML = html;
}
$("progress-btn").addEventListener("click", openProgress);
$("progress-close").addEventListener("click", closeProgress);
$("progress-backdrop").addEventListener("click", closeProgress);

/* ---------- keyboard shortcuts: ⌘/Ctrl+↵ run · ⌘/Ctrl+⇧+↵ send/review ---------- */
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter") return;
  e.preventDefault();
  if (e.shiftKey) {
    if (!$("send").disabled) submit(false);
    else if (!$("review").disabled) submit(true);
  } else if ($("run").style.display !== "none" && !$("run").disabled) {
    onRun();
  }
});

/* ---------- run (client-side) ---------- */
$("run").addEventListener("click", onRun);
async function onRun() {
  const tests = activeTests(currentState);
  const lang = currentLang();
  if (!runtimeAvailable(lang)) return;
  const ranCode = editor.getValue();
  const btn = $("run"); btn.disabled = true; btn.textContent = "Running…";
  renderOutput("", "");
  try {
    const res = await runCode({ lang, code: ranCode, entry: tests.entry, cases: tests.cases || [], onStatus: (m) => renderOutput(m, "") });
    const stamp = new Date().toLocaleTimeString();
    renderOutput(res.stdout, res.stderr, stamp);
    if (res.cases.length) {
      const passed = res.cases.filter((c) => c.passed).length;
      clientResults[cache.view] = res.cases;
      $("cases-wrap").innerHTML = caseRows(res.cases, stamp);  // always rebuild -> a re-run is visible
      cache.cases = JSON.stringify(res.cases);                 // keep poll from clobbering it
      lastRun = { lang: runtimeLang(lang), total: res.cases.length, passed };
      greenCode = (passed === res.cases.length) ? ranCode : null;  // unlock Send only on all-green
      toast(greenCode
        ? `Ran ✓ — all ${passed} checks pass. <b>Send</b> unlocked.`
        : `Ran — ${passed}/${res.cases.length} passed. Edit & Run again, or “Review my attempt”.`, 3000);
    } else {
      lastRun = { lang: runtimeLang(lang), total: 0, passed: 0 };
      toast("Ran — see output above.", 2200);
    }
  } catch (e) {
    renderOutput("", "Run failed: " + e.message);
  } finally {
    btn.disabled = false; btn.textContent = "Run ▷";
    updateSendGate();
  }
}

/* ---------- output + cases rendering ---------- */
function renderOutput(stdout, stderr, stamp) {
  const wrap = $("output-wrap");
  if (!stdout && !stderr) { wrap.innerHTML = ""; return; }
  const bar = stamp ? `output <span class="ostamp">ran ${stamp}</span>` : "output";
  wrap.innerHTML = `<div class="output${stamp ? " ran" : ""}"><div class="obar">${bar}</div><pre>${esc(stdout || "")}${stderr ? `<span class="err">${esc(stderr)}</span>` : ""}</pre></div>`;
}
function caseRows(rows, stamp) {
  const items = rows.map((r) => {
    if (r.pending) return `<li class="case pending"><span class="ci">▷</span><span class="cn">${esc(r.name || "case")}</span><span class="cx">not run</span></li>`;
    const ok = r.passed;
    const detail = (!ok && r.error) ? `<div class="cdiff"><span class="cd-err">error: ${esc(r.error)}</span></div>`
      : (!ok) ? `<div class="cdiff"><span class="cd-exp">expected <code>${esc(JSON.stringify(r.expected))}</code></span><span class="cd-got">got <code>${esc(JSON.stringify(r.got))}</code></span></div>` : "";
    return `<li class="case ${ok ? "pass" : "fail"}"><span class="ci">${ok ? "✓" : "✗"}</span><span class="cn">${esc(r.name || "case")}</span>${detail}</li>`;
  }).join("");
  const passed = rows.filter((r) => r.passed).length;
  const tail = stamp ? `<span class="cstamp">ran ${stamp}</span>` : "";
  return `<div class="cases${stamp ? " ran" : ""}"><div class="cbar">checks <span class="ctall">${passed}/${rows.length}</span>${tail}</div><ul class="caselist">${items}</ul></div>`;
}
function renderCases(s) {
  const wrap = $("cases-wrap");
  const defs = (activeTests(s).cases) || [];
  let rows;
  const client = clientResults[cache.view];
  if (client) rows = client;
  else if (defs.length && defs.some((c) => c.passed != null)) rows = defs.map((c) => ({ name: c.name, passed: c.passed, got: c.got, expected: c.expected, error: c.error }));
  else if (defs.length) rows = defs.map((c) => ({ name: c.name, pending: true, expected: c.expected }));
  else { if (cache.cases !== null) { wrap.innerHTML = ""; cache.cases = null; } return; }
  const sig = JSON.stringify(rows);
  if (sig === cache.cases) return;
  cache.cases = sig; wrap.innerHTML = caseRows(rows);
}

/* ---------- section updaters ---------- */
const STATUS_LABEL = { listening: "tutor is listening", thinking: "tutor is reviewing…", waiting_for_you: "your move", paused: "paused" };
function updateHeader(s) {
  setText($("title"), s.title || "Coding session");
  const st = s.tutor_status || "listening";
  if (st !== cache.statusS) { $("status").dataset.s = st; cache.statusS = st; }
  setText($("status-label"), STATUS_LABEL[st] || "ready");
  const working = $("working");
  if (st === "thinking") {
    setText($("working-msg"), (s.phase === "intake" || !(s.steps && s.steps.length)) ? "Building your lesson…" : "Reviewing your code…");
    working.hidden = false;
  } else {
    working.hidden = true;
  }
  if (s.mode && s.mode !== cache.badge) { const b = $("mode-badge"); b.hidden = false; b.textContent = s.mode; b.className = "badge " + s.mode; cache.badge = s.mode; }
}
function updateRail(s) {
  if (s.level !== cache.level) { $("meta-level").innerHTML = "Level: <b>" + esc(s.level || "—") + "</b>"; cache.level = s.level; }
  if (s.goal !== cache.goal) { $("meta-goal").innerHTML = "Goal: <b>" + esc(s.goal || "—") + "</b>"; cache.goal = s.goal; }
  const p = s.progress || {}; const sig = (p.step || 0) + "/" + (p.total || "?");
  if (sig !== cache.prog) {
    if (p.step) {
      const pct = p.total ? Math.round((p.step / p.total) * 100) : Math.min(p.step * 14, 92);
      $("prog-fill").style.width = pct + "%";
      const track = $("prog-track"); if (track) track.setAttribute("aria-valuenow", pct);
      $("prog-label").textContent = p.total ? `step ${p.step} of ${p.total}` : `step ${p.step}`;
    }
    cache.prog = sig;
  }
}
function updateLearned(items) {
  const sig = JSON.stringify(items);
  if (sig === cache.learned) return;
  const ul = $("learned");
  if (!items.length) ul.innerHTML = '<li class="empty">Your wins will collect here as you go.</li>';
  else ul.innerHTML = items.map((t, i) => `<li class="${i >= learnedPrev.length ? "fresh" : ""}">${esc(t)}</li>`).join("");
  learnedPrev = items.slice(); cache.learned = sig;
}
function updateProfile(p) {
  const sig = JSON.stringify(p || null);
  if (sig === cache.profile) return;
  cache.profile = sig;
  const wrap = $("profile-wrap");
  if (!p) { wrap.innerHTML = ""; return; }
  const bits = [];
  if (p.streak) bits.push(`<span class="pchip">🔥 ${esc(p.streak)}-day streak</span>`);
  if (p.sessions != null) bits.push(`<span class="pchip">${esc(p.sessions)} sessions</span>`);
  if (p.concepts != null) bits.push(`<span class="pchip">${esc(p.concepts)} concepts</span>`);
  wrap.innerHTML = `<h2>Your journey</h2>${p.welcome ? `<div class="pwelcome md">${md(p.welcome)}</div>` : ""}${bits.length ? `<div class="pchips">${bits.join("")}</div>` : ""}`;
}
function updateFeedback(fb) {
  const sig = fb ? (fb.status || "none") + " " + (fb.md || "") : "none";
  if (sig === cache.feedback) return;
  cache.feedback = sig;
  const wrap = $("feedback-wrap");
  if (!fb || !fb.status || fb.status === "none") { wrap.innerHTML = ""; return; }
  const label = { pass: "nice — that works", retry: "not yet — let's adjust", comment: "from your tutor" }[fb.status] || "from your tutor";
  wrap.innerHTML = `<div class="feedback ${fb.status}"><span class="tag">${label}</span><div class="md">${md(fb.md)}</div></div>`;
}
function updateTests(t) {
  const sig = t ? (t.cmd || "") + "|" + (t.output || "") + "|" + t.passed : "none";
  if (sig === cache.tests) return;
  cache.tests = sig;
  const wrap = $("tests-wrap");
  if (!t || !t.cmd) { wrap.innerHTML = ""; return; }
  const res = t.passed === true ? '<span class="result pass">passed</span>' : t.passed === false ? '<span class="result fail">failed</span>' : "";
  wrap.innerHTML = `<div class="tests"><div class="bar"><span>tutor ran</span><span class="cmd">${esc(t.cmd)}</span>${res}</div>${t.output ? `<pre>${esc(t.output)}</pre>` : ""}</div>`;
}

/* ---------- lesson region ---------- */
function buildIntake(s) {
  const el = $("lesson"); el.className = "intake";
  el.innerHTML = `
    <p class="eyebrow">before we start</p>
    <h1 class="step-head">Let's tune this to you.</h1>
    <p class="lead">${esc(s.intro || "Pick where you're at and how much help you want. Your tutor shapes the steps around it — you always write the code.")}</p>
    <div class="field"><label id="lvl-l">How comfortable are you here?</label>
      <div class="chips" id="lvl" role="group" aria-labelledby="lvl-l">
        <button class="chip" data-v="beginner" aria-pressed="false">Beginner</button>
        <button class="chip" data-v="intermediate" aria-pressed="false">Intermediate</button>
        <button class="chip" data-v="advanced" aria-pressed="false">Advanced</button>
      </div></div>
    <div class="field"><label id="gd-l">How much help? <span class="sub">hints never hand you the answer</span></label>
      <div class="chips" id="gd" role="group" aria-labelledby="gd-l">
        <button class="chip" data-v="minimal" aria-pressed="false">Minimal</button>
        <button class="chip on" data-v="balanced" aria-pressed="true">Balanced</button>
        <button class="chip" data-v="guided" aria-pressed="false">Guided</button>
      </div></div>
    <div class="field"><label>What do you want to walk away understanding?</label>
      <textarea id="goal" placeholder="e.g. how this auth middleware actually verifies a token"></textarea></div>
    <button class="btn primary" id="begin">Begin →</button>`;
  let level = null, guidance = "balanced";
  const wire = (groupId, set) => el.querySelectorAll("#" + groupId + " .chip").forEach((c) =>
    c.addEventListener("click", () => {
      el.querySelectorAll("#" + groupId + " .chip").forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); });
      c.classList.add("on"); c.setAttribute("aria-pressed", "true"); set(c.dataset.v);
    }));
  wire("lvl", (v) => { level = v; });
  wire("gd", (v) => { guidance = v; });
  $("begin").addEventListener("click", () => {
    const goal = $("goal").value.trim();
    if (!level) return toast("Pick a level first ☝️", 2500);
    if (!goal) return toast("Tell your tutor what you're after.", 2500);
    $("begin").disabled = true; post({ type: "intake", level, goal, guidance });
    toast("Got it — building your first step…");
  });
  showWork(false);
}
function buildStep(s) {
  const step = activeStep(s); const el = $("lesson"); el.className = "";
  const hints = step.hints || [];
  el.innerHTML = `
    <p class="eyebrow">${esc(step.eyebrow || (s.progress && s.progress.step ? "step " + s.progress.step : "step"))}</p>
    <h1 class="step-head">${esc(step.heading || "Working…")}</h1>
    <div class="md">${md(step.body_md)}</div>
    ${step.task_md ? `<div class="task"><p class="eyebrow">your task</p><div class="md">${md(step.task_md)}</div></div>` : ""}
    <div class="hints" id="hints"><button class="hint-btn" id="hint-btn">Need a nudge?</button></div>`;
  revealedHints = 0;
  wireHints(hints);

  showWork(true);
  setText($("file-name"), step.file || "scratch");
  const lang = currentLang();
  setText($("file-lang"), lang);
  if (editor) editor.setLanguage(lang);

  // Run button only when a client runtime exists for this language
  const canRun = runtimeAvailable(lang);
  const verify = canRun && !!(activeTests(s).cases && activeTests(s).cases.length);
  $("run").style.display = canRun ? "" : "none";
  $("run-hint").textContent = verify
    ? "Run to check yourself — Send unlocks when every check is ✓. Failing or stuck? “Review my attempt” gives a walkthrough anytime."
    : canRun
    ? "Run to try it out, then Send — or “Review my attempt” for a walkthrough anytime."
    : "Send when ready, or “Review my attempt” for a walkthrough — your tutor runs this language for you.";

  starterCode = step.starter_code || "";
  const key = (s.progress && s.progress.step) + "|" + (step.heading || "");
  if (key !== lastSeededStep && editorDirtyStep !== key) {
    if (editor) editor.setValue((s.submission && s.submission.code) || starterCode);
    lastSeededStep = key;
  }
  renderOutput("", "");
  greenCode = null;
  $("review").disabled = false; $("reset").disabled = false;
  updateSendGate();
}
function buildDone(s) {
  const el = $("lesson"); el.className = "done";
  el.innerHTML = `
    <p class="eyebrow">🎉 session complete</p>
    <h1 class="step-head">${esc(s.title || "Great work — you did it.")}</h1>
    <div class="md">${md(s.summary_md || "")}</div>
    <div class="done-actions">
      <button class="btn primary" id="copy-recap">Copy recap</button>
      <span class="seal">Saved to your history. You can close this tab and head back to your terminal.</span>
    </div>`;
  showWork(false);
  const cp = $("copy-recap");
  if (cp) cp.addEventListener("click", () => {
    const text = (s.summary_md || "") + "\n\nLearned:\n" + (s.learned || []).map((x) => "- " + x).join("\n");
    navigator.clipboard.writeText(text).then(() => toast("Recap copied ✓"), () => toast("Copy failed", 2000));
  });
}
function showWork(on) {
  document.querySelector(".work").style.display = on ? "" : "none";
}
function wireHints(hints) {
  const btn = $("hint-btn"), wrap = $("hints");
  btn.addEventListener("click", () => {
    if (revealedHints < hints.length) {
      // Pre-authored hints (curated lessons): reveal the next one locally, no tutor turn.
      const i = revealedHints++;
      const h = document.createElement("p"); h.className = "hint";
      h.innerHTML = `<b>nudge ${i + 1}.</b> ${mdInline(hints[i])}`;
      wrap.insertBefore(h, btn);
      post({ type: "hint", level: revealedHints });
      return;
    }
    // No (more) pre-authored hints: ask the tutor for an on-the-fly nudge (cheap; matches
    // the managed SaaS). The reply renders through the normal feedback path.
    post({ type: "hint", code: editor ? editor.getValue() : "", client_tests: lastRun });
  });
}

/* ---------- main render ---------- */
function render(s) {
  currentState = s;
  updateHeader(s); updateRail(s); updateLearned(s.learned || []); updateProfile(s.profile);

  let view;
  if (s.phase === "intake" && (!s.level || !s.goal)) view = "intake";
  else if (s.phase === "done") view = "done";
  else view = "step:" + (s.progress && s.progress.step) + "|" + (activeStep(s).heading || "");

  if (view !== cache.view) {
    cache.view = view;
    if (view === "intake") buildIntake(s);
    else if (view === "done") buildDone(s);
    else buildStep(s);
    lastRun = null; cache.cases = null;
    if (view === "done" && !confettiDone) { confettiDone = true; fireConfetti(); }
  }

  if (view.startsWith("step:")) renderCases(s);
  updateFeedback(s.feedback);
  updateTests(activeTests(s));
  $("paused-banner").hidden = (s.tutor_status !== "paused");
  if (awaiting && (cache.feedback !== sentFeedbackSig || cache.view !== sentView)) unlockSubmit();
}

/* ---------- boot ---------- */
async function tick() {
  try { const r = await fetch("/api/state", { cache: "no-store" }); render(await r.json()); } catch (e) {}
}
(async function boot() {
  editor = await createEditor($("editor-mount"), { doc: "", lang: "python", onChange: () => { editorDirtyStep = cache.view; updateSendGate(); } });
  await probeBash().catch(() => {});      // enable bash Run if the server has a container runtime
  await tick();
  setInterval(tick, POLL_MS);
})();
