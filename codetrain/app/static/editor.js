/* CodeTrain — editor.
   A reliable syntax-highlighting editor with NO runtime CDN: a transparent
   <textarea> (rock-solid editing) layered over a Prism-highlighted <pre> that
   scroll-syncs with it. Prism is vendored locally (prism.js), so there is nothing
   to time out and it works offline. If Prism somehow isn't present, falls back to
   a plain textarea. Same tiny API either way:
     createEditor(mount, {doc, lang, onChange}) ->
       { getValue, setValue(doc), setLanguage(lang), focus(), kind }
*/

const LANG = { python: "python", py: "python", javascript: "javascript", js: "javascript", node: "javascript", bash: "bash", sh: "bash", shell: "bash" };
function grammar(l) { return LANG[(l || "").toLowerCase()] || "none"; }

function makePrism(mount, opts) {
  mount.classList.add("cwrap");
  mount.innerHTML = `
    <div class="gutter" data-gutter aria-hidden="true">1</div>
    <div class="celayers">
      <pre class="chl" aria-hidden="true"><code></code></pre>
      <textarea class="cinput" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="Code editor"></textarea>
    </div>`;
  const ta = mount.querySelector(".cinput");
  const code = mount.querySelector(".chl code");
  const pre = mount.querySelector(".chl");
  const gutter = mount.querySelector("[data-gutter]");
  let lang = opts.lang || "python";

  function highlight() {
    const v = ta.value;
    const g = grammar(lang);
    code.className = "language-" + g;
    code.textContent = v + (v.endsWith("\n") ? " " : "");   // keep last line tall
    const P = window.Prism;
    if (P && P.languages[g]) P.highlightElement(code);
  }
  function gut() {
    const n = Math.max(ta.value.split("\n").length, 1);
    gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join("\n");
  }
  function syncScroll() { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; gutter.scrollTop = ta.scrollTop; }

  ta.addEventListener("input", () => { highlight(); gut(); if (opts.onChange) opts.onChange(); });
  ta.addEventListener("scroll", syncScroll);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + "    " + ta.value.slice(en);
      ta.selectionStart = ta.selectionEnd = s + 4;
      highlight(); gut(); if (opts.onChange) opts.onChange();
    }
  });

  ta.value = opts.doc || "";
  highlight(); gut();
  return {
    kind: "prism",
    getValue: () => ta.value,
    setValue: (d) => { ta.value = d || ""; highlight(); gut(); syncScroll(); },
    setLanguage: (l) => { lang = l || lang; highlight(); },
    focus: () => ta.focus(),
    // Re-align the highlight <pre> + gutter to the textarea after a layout change
    // (e.g. the full-page pop-out toggle), which fires no scroll/input event.
    resync: () => { highlight(); gut(); syncScroll(); },
  };
}

function makeTextarea(mount, opts) {
  mount.innerHTML = '<div class="ta-wrap"><div class="gutter" data-gutter aria-hidden="true">1</div><textarea spellcheck="false" aria-label="Code editor"></textarea></div>';
  const ta = mount.querySelector("textarea");
  const gutter = mount.querySelector("[data-gutter]");
  ta.value = opts.doc || "";
  const sync = () => {
    const n = Math.max(ta.value.split("\n").length, 1);
    gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join("\n");
  };
  ta.addEventListener("input", () => { sync(); if (opts.onChange) opts.onChange(); });
  ta.addEventListener("scroll", () => { gutter.scrollTop = ta.scrollTop; });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + "    " + ta.value.slice(en);
      ta.selectionStart = ta.selectionEnd = s + 4;
      sync();
    }
  });
  sync();
  return {
    kind: "textarea",
    getValue: () => ta.value,
    setValue: (d) => { ta.value = d || ""; sync(); },
    setLanguage: () => {},
    focus: () => ta.focus(),
    resync: () => { sync(); gutter.scrollTop = ta.scrollTop; },
  };
}

export async function createEditor(mount, opts = {}) {
  try {
    if (window.Prism) return makePrism(mount, opts);
    throw new Error("Prism not loaded");
  } catch (e) {
    console.warn("Prism overlay unavailable, using plain textarea:", e.message);
    return makeTextarea(mount, opts);
  }
}
