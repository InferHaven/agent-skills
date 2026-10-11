/* CodeTrain — front-end (ES module).
   Idempotent rendering (no flicker), CodeMirror/textarea editor, instant
   client-side Run for Python/JS, structured test results, auto-review on Send. */

import { createEditor } from "./editor.js";
import { runCode, runtimeAvailable, runtimeLang, probeBash } from "./runner.js";
import { VISUALS } from "./visuals.js";

/* Lesson visuals reach this UI the same way they reach the hosted study screen: the managed API
   returns them, so the local server is a courier rather than an author. visuals.js is a byte copy
   of web/app/study/visuals.js and test_visuals.py fails if the two drift.

   The renderers build DOM and set textContent, so a spec is never interpreted as markup here
   either. That matters more locally, not less: this page is served off the learner's own
   loopback, where a same-origin injection sits next to their workspace. */
function mountVisual(host, spec) {
  if (!host || !spec) return;
  const fn = VISUALS[spec.widget];
  if (fn) { try { fn(host, spec); } catch (e) { host.innerHTML = ""; } }
}

const $ = (id) => document.getElementById(id);
const POLL_MS = 1200;

const cache = {
  title: null, statusS: null, badge: null, level: null, goal: null, prog: null,
  learned: null, feedback: null, tests: null, cases: null, view: null, profile: null, usage: null,
  patch: null,
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
let sawThinking = false;   // saw tutor_status flip to "thinking" since we locked (gates idle-unlock)

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

/* ---------- editor theme (the typing-area palette, persisted) ---------- */
const EDITOR_THEMES = ["dark", "midnight", "hacker", "light"];
function applyEditorTheme(name) {
  const ed = $("editor-mount");
  if (!ed) return;
  EDITOR_THEMES.forEach((t) => ed.classList.remove("etheme-" + t));
  ed.classList.add("etheme-" + (EDITOR_THEMES.includes(name) ? name : "dark"));
}
(function initEditorTheme() {
  const sel = $("editor-theme");
  const saved = localStorage.getItem("tutor-editor-theme") || "dark";
  applyEditorTheme(saved);
  if (sel) {
    sel.value = saved;
    sel.addEventListener("change", () => {
      applyEditorTheme(sel.value);
      localStorage.setItem("tutor-editor-theme", sel.value);
    });
  }
})();

/* ---------- helpers ---------- */
function setText(el, txt) { if (el.textContent !== txt) el.textContent = txt; }
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
/* The renderer is shared with the hosted study screen in prose.js (tables, lists, headings), so
   both show a reply the same way. The body below is the old one, kept for a prose.js that failed
   to load. */
function md(src) {
  if (!src) return "";
  const P = window.CTProse;
  if (P && P.toHtml) {
    try { return P.toHtml(src); }
    catch (e) { /* fall through to the local renderer */ }
  }
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

/* ---------- overlay popup (quick language reference) ---------- */
function _escClose(e) { if (e.key === "Escape") closeOverlay(); }
function closeOverlay() {
  const o = $("overlay"); if (o) o.remove();
  document.removeEventListener("keydown", _escClose);
}
/* The question the tutor opens a step with, pulled out of the body so it can be styled as a
   question rather than as the first line of the explanation. prose.js is byte-identical with the
   hosted copy, so both front ends split the same step the same way. */
function openerOf(bodyMd) {
  const P = window.CTProse;
  if (!P) return { question: "", rest: bodyMd || "" };
  try { return P.splitOpener(bodyMd || ""); }
  catch (e) { return { question: "", rest: bodyMd || "" }; }
}

function questionHtml(q) {
  if (!q) return "";
  return `<div class="step-q"><p class="eyebrow">the question</p>
    <div class="step-q-b">${md(q)}</div></div>`;
}

/* Open a file the lesson cited, read from the learner's own checkout by the local server. The
   allowlist is `repo_cited`, which the agent built from the repo reader that already refuses
   secrets, gitignored files and binaries -- so nothing here needs a second copy of that denylist,
   and a path the model invented is never offered. */
function wireRepoFiles(el, s) {
  const P = window.CTProse;
  const cited = (s && s.repo_cited) || [];
  if (!P || !el) return;
  if (!cited.length) { P.reset(); return; }
  try {
    P.configure({
      paths: cited,
      source: (s && s.repo_root) || "your checkout",
      openOverlay,
      load: (path) => fetch("/api/repo-file?path=" + encodeURIComponent(path))
        .then((r) => r.json())
        .then((d) => { if (d && d.error) throw new Error(d.error); return d; }),
    });
    P.link(el);
  } catch (e) { /* the prose is correct without the links */ }
}

function openOverlay(title, html) {
  closeOverlay();
  const o = document.createElement("div");
  o.className = "overlay"; o.id = "overlay";
  o.innerHTML = `<div class="overlay-box"><div class="overlay-head"><span>${esc(title)}</span>
    <button class="btn ghost" id="ov-close">Close ✕</button></div><div class="overlay-body">${html}</div></div>`;
  document.body.appendChild(o);
  $("ov-close").addEventListener("click", closeOverlay);
  o.addEventListener("click", (e) => { if (e.target === o) closeOverlay(); });
  document.addEventListener("keydown", _escClose);
}
const REFERENCE = {
  python: [["print(x)", "write a line to output"], ["len(x)", "length of a string/list"], ["range(a, b)", "numbers a … b-1"], ["[f(x) for x in xs]", "list comprehension"], ["s.split(sep)", "split a string into a list"], ["if / elif / else", "branch on conditions"], ["for x in xs:", "loop over items"], ["def name(args):", "define a function; return hands a value back"], ["d[k] / d.get(k)", "dict lookup (get is safe)"], ["x % y", "remainder — even when x % 2 == 0"]],
  javascript: [["console.log(x)", "print to output"], ["arr.map(fn)", "new array, fn on each item"], ["arr.filter(fn)", "keep items where fn is true"], ["arr.reduce((a, x) => …, 0)", "fold to one value"], ["`${x}`", "template string"], ["const / let", "declare a variable"], ["x === y", "strict equality"], ["arr.length", "number of items"], ["(a, b) => a + b", "arrow function"]],
  bash: [["echo X", "print text"], ["ls -l", "list files (long form)"], ["VAR=value ; $VAR", "set / use a variable"], ["for i in 1 2 3; do … done", "loop"], ["if [ cond ]; then … fi", "branch"], ["grep pat file", "search lines"], ["chmod 644 f", "set permissions"], ["mkdir d / touch f", "make a dir / file"], ["cmd1 | cmd2", "pipe output"]],
  ruby: [["puts x", "print a line"], ["arr.map { |x| … }", "transform each"], ["arr.select { |x| … }", "keep matching"], ["def name; end", "method"], ["x.times { … }", "repeat x times"]],
  perl: [["print \"$x\\n\"", "print"], ["my $x = …", "declare a variable"], ["foreach my $i (@a) { }", "loop"], ["if (cond) { }", "branch"], ["$str =~ /pat/", "regex match"]],
  php: [["echo $x;", "print"], ["$arr = [1, 2];", "array"], ["foreach ($a as $x) { }", "loop"], ["function name() { }", "function"], ["if (cond) { }", "branch"]],
};
function openReference(lang) {
  const aliases = { sh: "bash", shell: "bash", node: "javascript", js: "javascript", py: "python", "php-web": "php" };
  const l = aliases[(lang || "").toLowerCase()] || (lang || "").toLowerCase();
  // Prefer the lesson-specific card authored with the course; static per-language fallback.
  const dyn = (currentState && Array.isArray(currentState.reference)) ? currentState.reference : [];
  const rows = dyn.length ? dyn.map((r) => [r.snippet, r.note]) : (REFERENCE[l] || REFERENCE.python);
  const html = `<table class="reftab">${rows.map(([a, b]) => `<tr><td><code>${esc(a)}</code></td><td class="muted">${esc(b)}</td></tr>`).join("")}</table>
    <p class="muted" style="margin-top:10px;font-size:0.78rem">A quick reference, not the answer — combine these to solve the step.</p>`;
  openOverlay(dyn.length ? "lesson reference" : `${l} reference`, html);
}

/* ---------- submit / lock ---------- */
// Can we verify correctness in the browser for this step? (runtime + cases)
function canVerify() {
  const t = activeTests(currentState);
  return runtimeAvailable(currentLang()) && !!(t.cases && t.cases.length);
}
// Send is the "advance me" action: gated to all-green when verifiable client-side.
// Review my attempt is always available (works on failing code).
function mcqSelection() {
  const sel = document.querySelector('#mcq-wrap input[name="mcq"]:checked');
  return sel ? +sel.value : null;
}
function updateSendGate() {
  if (awaiting) return;                       // locked mid-review; leave as-is
  const send = $("send");
  if (activeStep(currentState).mcq) {         // concept check: gate on a picked option
    const picked = mcqSelection() !== null;
    send.disabled = !picked;
    send.title = picked ? "Send your answer" : "Pick an option first";
    return;
  }
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
  awaiting = true; sentFeedbackSig = cache.feedback; sentView = cache.view; sawThinking = false;
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
  if (activeStep(currentState).mcq) {
    const choice = mcqSelection();
    if (choice === null) return;
    lockSubmit();
    post({ type: "submit", choice, note: $("note").value, mentions: extractMentions($("note").value) });
    $("note").value = "";
    toast("Answer sent — <b>reviewing…</b>");
    return;
  }
  lockSubmit();
  if (multiFiles.length > 1 && editor && activeFile) multiBuffers[activeFile] = editor.getValue();
  const primary = multiFiles.length > 1 ? (multiBuffers[multiFiles[0].file] || "") : editor.getValue();
  const _sub = { type: "submit", code: primary, note: $("note").value, client_tests: lastRun, review_request: !!reviewRequest, mentions: extractMentions($("note").value) };
  if (multiFiles.length > 1) _sub.files = multiBuffers;
  post(_sub);
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
$("reset").addEventListener("click", () => {
  if (multiFiles.length > 1 && activeFile) { const f = multiFiles.find((x) => x.file === activeFile) || {}; editor.setValue(f.starter_code || ""); }
  else editor.setValue(starterCode);
  editorDirtyStep = null; updateSendGate();
});
$("ref").addEventListener("click", () => openReference(currentLang()));

/* ---------- editor pop-out (full-page, distraction-free) ---------- */
// Firefox: an ancestor that has a transform animation (even finished, at transform:none) stays
// the containing block for position:fixed descendants, so the pop-out would stay pinned inside
// .work behind the backdrop. Settle animations as they end, and force-settle the editor's
// ancestor chain right before popping out in case an animationend never fired.
document.addEventListener("animationend", (e) => {
  if (e.animationName === "rise" && e.target.classList) e.target.classList.add("rise-done");
});
function settleAncestors(el) {
  for (let n = el && el.parentElement; n && n !== document.body; n = n.parentElement) {
    const names = (getComputedStyle(n).animationName || "").split(",");
    if (names.some((a) => a.trim() === "rise")) n.classList.add("rise-done");
  }
}
let edBackdrop = null;
function ensureBackdrop() {
  if (edBackdrop) return edBackdrop;
  edBackdrop = document.createElement("div");
  edBackdrop.className = "ed-backdrop"; edBackdrop.hidden = true;
  edBackdrop.addEventListener("click", () => setEditorFullscreen(false));
  document.body.appendChild(edBackdrop);
  return edBackdrop;
}
function ensureCloseBtn() {
  const ed = $("editor-mount"); if (!ed) return null;
  let btn = ed.querySelector(".ed-close");
  if (btn) return btn;
  // Floating exit affordance — the .file-tab Expand button sits behind the overlay when zoomed,
  // so the pop-out needs its own visible way out (Esc / backdrop also work).
  btn = document.createElement("button");
  btn.type = "button"; btn.className = "ed-close";
  btn.title = "Exit full screen (Esc)"; btn.setAttribute("aria-label", "Exit full screen");
  btn.textContent = "⤡ Exit";
  btn.addEventListener("click", () => setEditorFullscreen(false));
  ed.appendChild(btn);
  return btn;
}
function setEditorFullscreen(on) {
  const ed = $("editor-mount"); if (!ed) return;
  if (on) settleAncestors(ed);
  ensureBackdrop().hidden = !on;
  ensureCloseBtn();
  ed.classList.toggle("fullscreen", on);
  document.body.classList.toggle("ed-zoom", on);   // lock page scroll behind the overlay
  const b = $("ed-expand"); if (b) b.textContent = on ? "⤡ Exit" : "⤢ Expand";
  // The pop-out resizes the editor with no scroll/input event, so realign the
  // highlight + gutter to the textarea, then focus.
  if (editor) { if (editor.resync) editor.resync(); if (on) editor.focus(); }
}
$("ed-expand").addEventListener("click", () => setEditorFullscreen(!$("editor-mount").classList.contains("fullscreen")));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("editor-mount").classList.contains("fullscreen")) setEditorFullscreen(false);
});

/* ---------- @-mention: attach exact file context (repo files / uploaded files) ---------- */
let mentionFiles = [];
function extractMentions(text) {
  const found = []; const re = /@([^\s@]+)/g; let m;
  while ((m = re.exec(text || ""))) { if (mentionFiles.includes(m[1])) found.push(m[1]); }
  return [...new Set(found)];
}
function wireMention(input) {
  if (!input || input._mentionWired) return;
  input._mentionWired = true;
  const pop = document.createElement("div"); pop.className = "mention-pop"; pop.hidden = true;
  document.body.appendChild(pop);
  let active = 0, items = [];
  const hide = () => { pop.hidden = true; items = []; };
  const place = () => { const r = input.getBoundingClientRect(); pop.style.left = r.left + "px"; pop.style.width = Math.max(r.width, 220) + "px"; pop.style.top = (window.scrollY + r.top) + "px"; pop.style.transform = "translateY(-100%)"; };
  const upd = () => pop.querySelectorAll(".mi").forEach((el, i) => el.classList.toggle("on", i === active));
  function token() {
    const v = input.value, c = input.selectionStart, before = v.slice(0, c), at = before.lastIndexOf("@");
    if (at < 0) return null;
    const frag = before.slice(at + 1);
    return /\s/.test(frag) ? null : { at, query: frag };
  }
  function choose(i, tok) {
    const v = input.value, c = input.selectionStart;
    const head = v.slice(0, tok.at) + "@" + items[i] + " ";
    input.value = head + v.slice(c);
    input.selectionStart = input.selectionEnd = head.length;
    hide(); input.focus();
  }
  function show(tok) {
    items = mentionFiles.filter((f) => f.toLowerCase().includes(tok.query.toLowerCase())).slice(0, 8);
    if (!items.length) return hide();
    active = 0;
    pop.innerHTML = items.map((f, i) => `<div class="mi ${i === 0 ? "on" : ""}" data-i="${i}">${esc(f)}</div>`).join("");
    place(); pop.hidden = false;
    pop.querySelectorAll(".mi").forEach((el) => { el.onmousedown = (e) => { e.preventDefault(); choose(+el.dataset.i, tok); }; });
  }
  input.addEventListener("input", () => { const t = token(); t ? show(t) : hide(); });
  input.addEventListener("keydown", (e) => {
    if (pop.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, items.length - 1); upd(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); upd(); }
    else if (e.key === "Enter" || e.key === "Tab") { const t = token(); if (t && items.length) { e.preventDefault(); choose(active, t); } }
    else if (e.key === "Escape") hide();
  });
  input.addEventListener("blur", () => setTimeout(hide, 150));
}
wireMention($("note"));

/* ---------- multi-file step editor (a tab per file) ---------- */
let multiFiles = [], multiBuffers = {}, activeFile = null;
function renderFileTabs(files) {
  const wrap = $("file-tabs"); if (!wrap) return;
  if (!files || files.length < 2) { wrap.innerHTML = ""; wrap.hidden = true; return; }
  wrap.hidden = false;
  wrap.innerHTML = files.map((f) => `<button class="ftab ${f.file === activeFile ? "on" : ""}" data-f="${esc(f.file)}" type="button">${esc(f.file)}</button>`).join("");
  wrap.querySelectorAll(".ftab").forEach((b) => (b.onclick = () => switchFile(b.dataset.f)));
}
function switchFile(path) {
  if (activeFile && multiBuffers[activeFile] !== undefined && editor) multiBuffers[activeFile] = editor.getValue();
  activeFile = path;
  const f = multiFiles.find((x) => x.file === path) || {};
  if (editor) { editor.setLanguage(f.lang || "text"); editor.setValue(multiBuffers[path] || ""); }
  setText($("file-name"), path); setText($("file-lang"), f.lang || "text");
  renderFileTabs(multiFiles);
}
function seedMulti(step, s) {
  multiFiles = step.files;
  multiBuffers = {};
  // Seed each tab from its own file's content (starter_code = LIVE sandbox after the server
  // overlay, so accumulated edits show). Don't prefer s.submission.files — that global slot holds
  // the previous step's buffers and would leak the wrong files into a new multi-file step.
  multiFiles.forEach((f) => { multiBuffers[f.file] = f.starter_code || ""; });
  activeFile = null;
  switchFile(multiFiles[0].file);
}
$("skip").addEventListener("click", () => {
  if (awaiting) return;
  post({ type: "skip" });
  toast("Skipping ahead — <b>the next step is on its way.</b>");
});

/* ---------- ask a question (no code submit) ---------- */
$("ask").addEventListener("click", () => {
  const q = $("note").value.trim();
  if (!q) return toast("Type a question first ☝️", 2200);
  post({ type: "question", text: q, code: editor ? editor.getValue() : "", mentions: extractMentions(q) });
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
  if (lang === "dockerfile") {
    // Never executed — statically lint; the tutor narrates the simulated build on Submit.
    const findings = (typeof dockLint === "function") ? dockLint(editor.getValue()) : [];
    lastRun = { lang: "dockerfile", lint: findings, clean: !findings.length };
    renderOutput(
      findings.length
        ? findings.map((f) => `${f.line ? "L" + f.line + ": " : ""}[${f.rule}] ${f.msg}`).join("\n")
        : "✓ Lint clean — Send it and the tutor walks the build layer by layer.",
      "", new Date().toLocaleTimeString());
    toast(findings.length ? `Lint: ${findings.length} finding(s) — see output.` : "Lint clean ✓", 2600);
    updateSendGate();
    return;
  }
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
function checksHtml(checks) {
  if (!checks || !checks.length) return "";
  const items = checks.map((c) => {
    const ok = typeof c === "string" ? true : c.pass !== false;     // brick ✗ for a missing criterion
    const text = typeof c === "string" ? c : (c.label || "");
    return `<li class="${ok ? "ok" : "no"}">${esc(text)}</li>`;
  }).join("");
  return `<ul class="fb-checks">${items}</ul>`;
}
function diffHtml(diff) {
  return String(diff || "").split("\n").map((l) => {
    const cls = l.startsWith("+") && !l.startsWith("+++") ? "dl-add"
      : l.startsWith("-") && !l.startsWith("---") ? "dl-del"
      : l.startsWith("@@") ? "dl-hunk" : "";
    return `<span class="${cls}">${esc(l)}</span>`;
  }).join("\n");
}
function diffStats(diff) {
  let add = 0, del = 0;
  String(diff || "").split("\n").forEach((l) => {
    if (l.startsWith("+") && !l.startsWith("+++")) add++;
    else if (l.startsWith("-") && !l.startsWith("---")) del++;
  });
  return { add, del };
}
async function openFullDiff(p) {
  // The panel diff is capped (8 KB); the engine server stashes the complete one locally —
  // show EXACTLY what would be written, every added and removed line.
  let diff = p.diff;
  try {
    const r = await fetch("/api/patch-pending");
    if (r.ok) { const d = await r.json(); if (d && d.diff) diff = d.diff; }
  } catch (e) { /* fall back to the capped diff */ }
  const st = diffStats(diff);
  openOverlay(`Full diff — ${p.target}`,
    `<div class="patch-sum" style="margin-bottom:8px"><span class="dl-add">+${st.add}</span> · <span class="dl-del">−${st.del}</span> lines</div>
     <pre class="diff diff-full">${diffHtml(diff)}</pre>`);
}
function updatePatch(p) {
  const sig = JSON.stringify(p || null);
  if (sig === cache.patch) return;
  cache.patch = sig;
  const wrap = $("patch-wrap");
  if (!wrap) return;
  if (!p || !p.target) { wrap.innerHTML = ""; return; }
  const st = diffStats(p.diff);
  wrap.innerHTML = `<div class="patch-panel">
    <div class="patch-head"><span>Apply to your repo?</span><code>${esc(p.target)}</code>
      <span class="patch-stats"><span class="dl-add">+${st.add}</span> · <span class="dl-del">−${st.del}</span></span></div>
    ${p.summary ? `<div class="patch-sum">${esc(p.summary)}</div>` : ""}
    <pre class="diff">${diffHtml(p.diff)}</pre>
    <div class="patch-actions">
      <button class="btn primary" id="patch-apply">Apply to ${esc(p.target)}</button>
      <button class="btn ghost" id="patch-expand" title="Inspect every added/removed line before writing">Inspect full diff ⤢</button>
      <button class="btn ghost" id="patch-cancel">Not now</button>
      <span class="patch-note">A backup (<code>.codetrain.bak</code>) is saved before writing.</span>
    </div></div>`;
  $("patch-apply").addEventListener("click", () => {
    $("patch-apply").disabled = true; $("patch-cancel").disabled = true;
    post({ type: "patch_apply" }); toast("Writing to your repo…");
  });
  $("patch-expand").addEventListener("click", () => openFullDiff(p));
  $("patch-cancel").addEventListener("click", () => {
    $("patch-cancel").disabled = true; post({ type: "patch_cancel" });
  });
}
function updateUsage(u) {
  const sig = JSON.stringify(u || null);
  if (sig === cache.usage) return;
  cache.usage = sig;
  const wrap = $("usage-wrap");
  if (!wrap) return;
  if (!u || !u.plan) { wrap.innerHTML = ""; return; }
  const cap = u.monthly_sessions;
  const used = u.sessions_used != null ? u.sessions_used : 0;
  const bits = [
    `<span class="pchip">${esc(u.plan)} plan</span>`,
    `<span class="pchip">${esc(used)}${cap == null ? "" : "/" + esc(cap)} lessons</span>`,
  ];
  if (u.cost_used_pct != null) bits.push(`<span class="pchip">${esc(u.cost_used_pct)}% used</span>`);
  wrap.innerHTML = `<h2>Plan &amp; usage</h2><div class="pchips">${bits.join("")}</div>`;
}
// What the answer guard held back, behind a click. Same contract as the study page's copy in
// web/app/study/study.js: only a line reproducing the step the learner is still on reaches here,
// it is closed by default, and every span is escaped on its way into the <pre>.
function heldHtml(held) {
  if (!Array.isArray(held) || !held.length) return "";
  return `<details class="held"><summary>Show it anyway</summary>`
    + `<pre class="code">${held.map((s) => esc(s)).join("\n")}</pre></details>`;
}
function updateFeedback(fb) {
  // `visual` is part of the signature: a review that differs from the last one only by its
  // diagram is still a different review, and leaving it out would show the previous picture.
  const sig = fb ? (fb.status || "none") + " " + (fb.md || "") + " " + JSON.stringify(fb.checks || [])
    + " " + JSON.stringify(fb.visual || null) + " " + JSON.stringify(fb.held || null) : "none";
  if (sig === cache.feedback) return;
  cache.feedback = sig;
  const wrap = $("feedback-wrap");
  if (!fb || !fb.status || fb.status === "none") { wrap.innerHTML = ""; return; }
  const label = { pass: "nice — that works", retry: "not yet — let's adjust", comment: "from your tutor" }[fb.status] || "from your tutor";
  wrap.innerHTML = `<div class="feedback ${fb.status}"><span class="tag">${label}</span><div class="md">${md(fb.md)}</div>${heldHtml(fb.held)}${checksHtml(fb.checks)}${fb.visual ? `<div id="fb-visual"></div>` : ""}</div>`;
  mountVisual($("fb-visual"), fb.visual);
  gloss(wrap, currentLang());
  // Make it obvious where the tutor replied (esp. nudges): pull it into view + flash once.
  const box = wrap.firstElementChild;
  if (box) {
    box.classList.add("flash");
    setTimeout(() => box.classList.remove("flash"), 1400);
    try { wrap.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) { /* older browsers */ }
  }
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
/* Mirrors agent/tutor.py PERSONAS plus the "og" opt-out. Ids must match or the tutor falls
   back to the default and this picker quietly lies about what it selected. Same roster as the
   hosted study page. */
const PERSONAS = [
  { id: "plain", label: "Plain", note: "clear and direct" },
  { id: "coach", label: "Coach", note: "warm, notices what improved" },
  { id: "drill", label: "Drill sergeant", note: "harsh and impatient" },
  { id: "analogist", label: "The Analogist", note: "everyday comparisons" },
  { id: "socratic", label: "Socratic hardliner", note: "questions only" },
  { id: "og", label: "OG model", note: "the model's own voice" },
];

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
    ${s.repo_mode ? `<div class="field"><label id="intent-l">On your repo <span class="sub">Explore reads your code read-only; Guided change builds toward a real edit you can apply at the end</span></label>
      <div class="chips" id="intent" role="group" aria-labelledby="intent-l">
        <button class="chip on" data-v="explore" aria-pressed="true">Explore (read-only)</button>
        <button class="chip" data-v="guided" aria-pressed="false">Guided change</button>
      </div></div>` : ""}
    <div class="field"><label for="persona">Tutor voice <span class="sub">how it talks to you; it teaches the same either way</span></label>
      <select id="persona">${PERSONAS.map((p) => `<option value="${esc(p.id)}" ${p.id === (s.persona || "plain") ? "selected" : ""}>${esc(p.label)} — ${esc(p.note)}</option>`).join("")}</select></div>
    <div class="field"><label>${s.repo_mode ? "What do you want to learn or change in this repo?" : "What do you want to walk away understanding?"}</label>
      <textarea id="goal" placeholder="${s.repo_mode ? "e.g. walk me through adding a --verbose flag, or explain how auth works" : "e.g. how this auth middleware actually verifies a token"}"></textarea></div>
    ${(s.models && s.models.length > 1) ? `<div class="field"><label for="model">Model <span class="sub">repo work and deeper reviews do best on Sonnet</span></label>
      <select id="model">${s.models.map((m) => `<option value="${esc(m.id)}" ${m.id === (s.model || "") ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</select></div>` : ""}
    <button class="btn primary" id="begin">Begin →</button>`;
  let level = null, guidance = "balanced", intent = "explore";
  const wire = (groupId, set) => el.querySelectorAll("#" + groupId + " .chip").forEach((c) =>
    c.addEventListener("click", () => {
      el.querySelectorAll("#" + groupId + " .chip").forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); });
      c.classList.add("on"); c.setAttribute("aria-pressed", "true"); set(c.dataset.v);
    }));
  wire("lvl", (v) => { level = v; });
  wire("gd", (v) => { guidance = v; });
  if (s.repo_mode) wire("intent", (v) => { intent = v; });
  wireMention($("goal"));
  $("begin").addEventListener("click", () => {
    const goal = $("goal").value.trim();
    if (!level) return toast("Pick a level first ☝️", 2500);
    if (!goal) return toast("Tell your tutor what you're after.", 2500);
    const modelEl = $("model");
    const model = modelEl ? modelEl.value : undefined;
    const personaEl = $("persona");
    const persona = personaEl ? personaEl.value : undefined;
    $("begin").disabled = true;
    post({ type: "intake", level, goal, guidance, model, persona, mentions: extractMentions(goal), ...(s.repo_mode ? { intent } : {}) });
    toast("Got it — building your first step…");
  });
  showWork(false);
}
/* Turn the first mention of each known term in tutor prose into a button that explains it. The
   glossary is a generated file loaded beside this one and byte-identical to the hosted copy, so
   the agent's browser UI explains the same words the same way.

   Runs after the container is in the document rather than over the markdown string: a pattern
   applied to an HTML string can match inside a tag or an attribute, and a walk over text nodes
   cannot. `md()` is untouched. Guarded and swallowing, because the links are decoration and the
   prose is already correct without them. */
function gloss(el, lang) {
  const G = window.CTGlossary;
  if (!G || !el) return;
  try { G.linkTerms(el, lang || currentLang() || ""); }
  catch (e) { /* the lesson is fine without the definitions */ }
}

function buildStep(s) {
  const step = activeStep(s); const el = $("lesson"); el.className = "";
  const hints = step.hints || [];
  const opener = openerOf(step.body_md);
  el.innerHTML = `
    <p class="eyebrow">${esc(step.eyebrow || (s.progress && s.progress.step ? "step " + s.progress.step : "step"))}</p>
    <h1 class="step-head">${esc(step.heading || "Working…")}</h1>
    ${questionHtml(opener.question)}
    <div class="md">${md(opener.rest)}</div>
    ${step.visual ? `<div id="step-visual"></div>` : ""}
    ${step.task_md ? `<div class="task"><p class="eyebrow">your task</p><div class="md">${md(step.task_md)}</div></div>` : ""}
    <div class="hints" id="hints"><button class="hint-btn" id="hint-btn">Need a nudge?</button></div>`;
  revealedHints = 0;
  wireHints(hints, step.hints_held || []);
  mountVisual($("step-visual"), step.visual);
  gloss(el, currentLang());
  wireRepoFiles(el, s);

  showWork(true);
  setText($("file-name"), step.file || "scratch");
  const lang = currentLang();
  setText($("file-lang"), lang);
  if (editor) editor.setLanguage(lang);

  // Run button only when a client runtime exists for this language (dockerfile "runs" as lint)
  const canRun = runtimeAvailable(lang) || lang === "dockerfile";
  const verify = canRun && !!(activeTests(s).cases && activeTests(s).cases.length);
  $("run").style.display = canRun ? "" : "none";
  $("run-hint").textContent = verify
    ? "Run to check yourself — Send unlocks when every check is ✓. Failing or stuck? “Review my attempt” gives a walkthrough anytime."
    : canRun
    ? "Run to try it out, then Send — or “Review my attempt” for a walkthrough anytime."
    : "Send when ready, or “Review my attempt” for a walkthrough — your tutor runs this language for you.";

  const multi = Array.isArray(step.files) && step.files.length > 1;
  starterCode = step.starter_code || "";
  const key = (s.progress && s.progress.step) + "|" + (step.heading || "");
  if (key !== lastSeededStep && editorDirtyStep !== key) {
    if (multi) {
      seedMulti(step, s);   // tabs + per-file buffers
    } else {
      multiFiles = []; multiBuffers = {}; activeFile = null; renderFileTabs(null);
      // Seed ONLY from this step's own file content. For repo steps `starter_code` is the LIVE
      // sandbox file (server overlays it), so re-editing a file shows the edits committed in
      // earlier steps. NEVER fall back to s.submission.code — that's a single global slot holding
      // the PREVIOUS step's text, which leaked the wrong file's content into a new step's editor.
      if (editor) editor.setValue(starterCode || "");
    }
    lastSeededStep = key;
  }
  renderOutput("", "");
  greenCode = null;
  renderMcqStep(step);
  $("review").disabled = false; $("reset").disabled = false;
  updateSendGate();
}
function renderMcqStep(step) {
  // Concept-check step: options replace the editor; Send posts the chosen index and the
  // tutor grades it (the correct answer never ships to the client).
  const mcq = step.mcq;
  const toggle = (id, hidden) => { const el = $(id); if (el) el.style.display = hidden ? "none" : ""; };
  ["editor-mount", "run", "reset", "run-hint", "file-tabs"].forEach((id) => toggle(id, !!mcq));
  const ft = document.querySelector(".file-tab");
  if (ft) ft.style.display = mcq ? "none" : "";
  let wrap = $("mcq-wrap");
  if (!mcq) { if (wrap) wrap.remove(); return; }
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "mcq-wrap"; wrap.className = "mcq";
    const anchor = $("editor-mount");
    anchor.parentNode.insertBefore(wrap, anchor);
  }
  const key = JSON.stringify(mcq);
  if (wrap.dataset.key === key) return;      // poll re-render must not clobber the selection
  wrap.dataset.key = key;
  wrap.innerHTML = `<p class="eyebrow">concept check</p>
    <p class="mcq-q">${esc(mcq.question)}</p>
    ${mcq.options.map((o, i) =>
      `<label class="mcq-opt"><input type="radio" name="mcq" value="${i}"><span>${esc(o)}</span></label>`).join("")}`;
  wrap.querySelectorAll("input").forEach((r) => r.addEventListener("change", updateSendGate));
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
function wireHints(hints, hintsHeld) {
  const btn = $("hint-btn"), wrap = $("hints");
  btn.addEventListener("click", () => {
    if (revealedHints < hints.length) {
      // Pre-authored hints (curated lessons): reveal the next one locally, no tutor turn.
      const i = revealedHints++;
      const h = document.createElement("p"); h.className = "hint";
      h.innerHTML = `<b>nudge ${i + 1}.</b> ${mdInline(hints[i])}`;
      wrap.insertBefore(h, btn);
      const held = heldHtml((hintsHeld || [])[i]);
      if (held) { const d = document.createElement("div"); d.innerHTML = held; wrap.insertBefore(d.firstChild, btn); }
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
  if (Array.isArray(s.mention_files)) mentionFiles = s.mention_files;
  updateHeader(s); updateRail(s); updateLearned(s.learned || []); updateProfile(s.profile); updateUsage(s.usage); updatePatch(s.patch);

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
  // Unlock the buttons when the turn resolves. Normally that's new feedback or a step change — but
  // an error whose text matches the previous feedback wouldn't change the signature, so ALSO unlock
  // whenever the tutor returns to idle (listening/paused) after we sent a turn. Without this, a
  // repeated error (e.g. "input too large" twice) leaves the buttons stuck on "Sent — reviewing…".
  if (awaiting && s.tutor_status === "thinking") sawThinking = true;
  const idle = (s.tutor_status === "listening" || s.tutor_status === "paused") && sawThinking;
  if (awaiting && (cache.feedback !== sentFeedbackSig || cache.view !== sentView || idle)) unlockSubmit();
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
