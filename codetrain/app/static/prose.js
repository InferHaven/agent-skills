/* CodeTrain — presentation for a step's tutor prose.

   BYTE-IDENTICAL with engine/app/static/prose.js. The agent runs a real browser UI off loopback
   and renders the same lessons, so both front ends must show the same step the same way. Copy one
   over the other, never hand-merge; the suite fails on drift, exactly as it does for visuals.js
   and js-worker.js.

   Three jobs, and they are the same job: a step's body is not one undifferentiated block of text.

   1. splitOpener — the tutor is told to open `body_md` with the question the step answers
      (OPENING_QUESTION, in both tutor brains). Rendered as the first line of ordinary prose, a
      weak question is indistinguishable from the explanation it introduces, and a good one loses
      the force of being a question at all. Pulling it out lets it be styled as what it is.

      SPLIT AT RENDER, NOT IN THE DATA. `body_md` stays whole on the server, so the answer-leak
      guard, the glossary linker and the published-lesson checks keep scanning the text they
      already scan, and every lesson authored before this shipped gets the treatment with no
      migration and no re-authoring.

   2. link/open — a repo lesson names real paths in its prose, which is what makes "built from the
      code that is actually in it" true, and until now the learner had nowhere to go with one.
      A cited path becomes a button that opens the file over the lesson. It costs no model tokens:
      the file comes from a static read, not from a turn.

      Linking walks TEXT that is already in the document rather than the markdown string, the same
      discipline glossary.js states and for the same reason: a pattern applied to an HTML string
      can match inside a tag or an attribute, and a walk over rendered elements cannot.

      ONLY PATHS THE SERVER WILL SERVE ARE OFFERED. The allowlist is the lesson's own checked
      citation list, so a path the model invented is left as plain text with nothing behind it.
      That is deliberate and visible: a real path lights up beside it.

   3. toHtml — the markdown both front ends' `md()` hand every piece of tutor prose to. Each app
      had its own, and neither knew a table: a tutor answering an ask with a three-row comparison
      put raw pipes on the study screen, and the agent's UI, which knew lists and the web did not,
      showed the same reply a second way. One renderer here is the same step rendered the same way.

      ESCAPE FIRST, THEN BUILD. The whole input is escaped before any rule runs, so every tag in
      the output is one this function wrote, and the only attributes are a fixed class list and a
      numeric `start`. No links: an href is the one thing in markdown that is an injection surface
      by design, and a tutor reply has nowhere it needs to send anyone.
      A string in, a string out, no DOM: the callers already set it with innerHTML exactly as they
      did before, so nothing about where the HTML goes has changed.
*/
(function (global) {
  "use strict";

  var MAX_QUESTION = 300;

  /* The first paragraph, and only when it ends in a question mark. Precision over recall: prose
     that merely contains a question keeps its shape, because promoting a mid-body aside into the
     step's headline question reads worse than not splitting at all. */
  function splitOpener(md) {
    var body = String(md == null ? "" : md);
    var cut = body.indexOf("\n\n");
    if (cut < 0) return { question: "", rest: body };
    var head = body.slice(0, cut).trim();
    var rest = body.slice(cut + 2).replace(/^\s+/, "");
    if (!head || !rest) return { question: "", rest: body };
    if (head.length > MAX_QUESTION) return { question: "", rest: body };
    if (head.charAt(head.length - 1) !== "?") return { question: "", rest: body };
    if (head.indexOf("```") >= 0 || head.charAt(0) === "#" || head.charAt(0) === "-") {
      return { question: "", rest: body };
    }
    // One question on one line. `md()` maps every newline to a <br>, so a model that hard-wraps
    // its paragraph would otherwise get a question broken across three lines in a box sized for
    // one. The body keeps its newlines; only the promoted question is collapsed.
    return { question: head.replace(/\s*\n\s*/g, " "), rest: rest };
  }

  // --- markdown --------------------------------------------------------------

  // A placeholder delimiter. Stripped from the input first, so it can only ever be one of ours.
  var HOLE = "\u0000";
  var HOLE_LINE = /^\s*\u0000\d+\u0000\s*$/;
  var HOLES = /\u0000(\d+)\u0000/g;
  // A language word counts only when the fence line ends after it, so "```print(1)```" is code
  // rather than a language called "print".
  var FENCE = /```(?:[\w+#.-]+[^\S\n]*\n|\n?)([\s\S]*?)```/g;
  var HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
  var RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  var ITEM = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
  var QUOTE = /^ {0,3}&gt; ?(.*)$/;
  var DELIM_CELL = /^:?-+:?$/;

  var ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function escHtml(s) { return s.replace(/[&<>"']/g, function (c) { return ENTITIES[c]; }); }

  function indentOf(ws) { return ws.replace(/\t/g, "    ").length; }
  function isItem(line) { return ITEM.test(line) && !RULE.test(line); }

  /* A row's cells. A pipe inside a code span does not split it, which is a kindness GFM does not
     offer: a JavaScript lesson's table of operators puts `||` in a cell, and that should not
     come out as three columns. `\|` is a literal pipe. */
  function cellsOf(line) {
    var s = line.trim();
    if (s.charAt(0) === "|") s = s.slice(1);
    if (s.charAt(s.length - 1) === "|" && s.charAt(s.length - 2) !== "\\") s = s.slice(0, -1);
    var out = [];
    var cur = "";
    for (var k = 0; k < s.length; k++) {
      var ch = s.charAt(k);
      if (ch === "\\" && s.charAt(k + 1) === "|") { cur += "|"; k++; continue; }
      if (ch === "`") {
        var end = s.indexOf("`", k + 1);
        if (end > k) { cur += s.slice(k, end + 1); k = end; continue; }
      }
      if (ch === "|") { out.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  /* A header row, then a delimiter row with the same number of cells. Requiring both, and the
     pipe in each, is what keeps an ordinary sentence with a pipe in it from becoming a table. */
  function tableAt(lines, i) {
    if (i + 1 >= lines.length) return null;
    var head = lines[i];
    var delim = lines[i + 1];
    if (head.indexOf("|") < 0 || delim.indexOf("|") < 0 || delim.indexOf("-") < 0) return null;
    var heads = cellsOf(head);
    var marks = cellsOf(delim);
    if (heads.length !== marks.length) return null;
    for (var k = 0; k < marks.length; k++) if (!DELIM_CELL.test(marks[k])) return null;
    return { heads: heads, align: marks.map(function (m) {
      var l = m.charAt(0) === ":";
      var r = m.charAt(m.length - 1) === ":";
      return l && r ? "al-c" : r ? "al-r" : "";
    }) };
  }

  function startsBlock(lines, i) {
    var line = lines[i];
    return HOLE_LINE.test(line) || HEADING.test(line) || RULE.test(line) || isItem(line)
      || QUOTE.test(line) || !!tableAt(lines, i);
  }

  function toHtml(src) {
    var holes = [];
    function hold(html) { holes.push(html); return HOLE + (holes.length - 1) + HOLE; }

    // Inline code goes out first so nothing inside it is ever read as emphasis. Italic runs
    // before bold because bold is two of the same character; the guards keep `*args`,
    // `**kwargs` and `2 * 3 * 4` literal. No `_italic_`: it would eat every snake_case name.
    function inline(s) {
      s = s.replace(/`([^`\n]+)`/g, function (_, c) { return hold('<code class="ic">' + c + "</code>"); });
      s = s.replace(/(^|[^*\w\\])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/g, "$1<em>$2</em>");
      s = s.replace(/\*\*(?=\S)([^*\n]*[^\s*])\*\*/g, "<strong>$1</strong>");
      return s.replace(/\n/g, "<br>");
    }

    function cell(tag, text, cls) {
      return "<" + tag + (cls ? ' class="' + cls + '"' : "") + ">" + inline(text) + "</" + tag + ">";
    }

    function table(lines, i, spec, out) {
      var n = spec.heads.length;
      var html = '<div class="md-table"><table><thead><tr>';
      for (var k = 0; k < n; k++) html += cell("th", spec.heads[k], spec.align[k]);
      html += "</tr></thead>";
      i += 2;
      var rows = "";
      while (i < lines.length && lines[i].trim() && lines[i].indexOf("|") >= 0 && !HOLE_LINE.test(lines[i])) {
        var cells = cellsOf(lines[i]);
        rows += "<tr>";
        for (var c = 0; c < n; c++) rows += cell("td", c < cells.length ? cells[c] : "", spec.align[c]);
        rows += "</tr>";
        i++;
      }
      if (rows) html += "<tbody>" + rows + "</tbody>";
      out.push(html + "</table></div>");
      return i;
    }

    function listOpen(item) {
      if (!item.ordered) return "<ul>";
      return item.num !== 1 ? '<ol start="' + item.num + '">' : "<ol>";
    }

    /* Consecutive items, an indent stack for nesting. A blank line between two items keeps them
       one list, because a tutor that spaces out "1." and "2." still means one sequence and two
       lists would both be numbered from one. */
    function list(lines, i, out) {
      var items = [];
      while (i < lines.length) {
        var line = lines[i];
        var m = isItem(line) ? ITEM.exec(line) : null;
        if (m) {
          items.push({ indent: indentOf(m[1]), ordered: /\d/.test(m[2]),
                       num: parseInt(m[2], 10), text: m[3] });
          i++;
          continue;
        }
        if (!line.trim()) {
          var j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && isItem(lines[j])) { i = j; continue; }
          break;
        }
        if (/^\s{2,}\S/.test(line) && !startsBlock(lines, i)) {
          items[items.length - 1].text += "\n" + line.trim();
          i++;
          continue;
        }
        break;
      }
      var html = "";
      var stack = [];
      items.forEach(function (it) {
        var tag = it.ordered ? "ol" : "ul";
        var top = stack[stack.length - 1];
        if (!top || it.indent >= top.indent + 2) {
          html += listOpen(it);
          stack.push({ indent: it.indent, tag: tag });
        } else {
          while (stack.length > 1 && it.indent < top.indent) {
            html += "</li></" + top.tag + ">";
            stack.pop();
            top = stack[stack.length - 1];
          }
          html += "</li>";
          if (top.tag !== tag) {
            html += "</" + top.tag + ">" + listOpen(it);
            top.tag = tag;
          }
        }
        html += "<li>" + inline(it.text);
      });
      while (stack.length) html += "</li></" + stack.pop().tag + ">";
      out.push(html);
      return i;
    }

    function blocks(lines) {
      var out = [];
      var i = 0;
      while (i < lines.length) {
        var line = lines[i];
        if (!line.trim()) { i++; continue; }
        if (HOLE_LINE.test(line)) { out.push(line.trim()); i++; continue; }
        var spec = tableAt(lines, i);
        if (spec) { i = table(lines, i, spec, out); continue; }
        var h = HEADING.exec(line);
        if (h) {
          var tag = h[1].length <= 2 ? "h3" : "h4";
          out.push("<" + tag + ">" + inline(h[2]) + "</" + tag + ">");
          i++;
          continue;
        }
        if (RULE.test(line)) { out.push("<hr>"); i++; continue; }
        if (isItem(line)) { i = list(lines, i, out); continue; }
        if (QUOTE.test(line)) {
          var quoted = [];
          while (i < lines.length && QUOTE.test(lines[i])) { quoted.push(QUOTE.exec(lines[i])[1]); i++; }
          out.push("<blockquote>" + blocks(quoted).join("") + "</blockquote>");
          continue;
        }
        // A paragraph runs to a blank line or to anything that opens a block, so "Here are the
        // methods:" followed directly by a list or a table is a sentence and then that block.
        var para = [line];
        i++;
        while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) { para.push(lines[i]); i++; }
        out.push("<p>" + inline(para.map(function (l) { return l.trim(); }).join("\n")) + "</p>");
      }
      return out;
    }

    var text = String(src == null ? "" : src).replace(/\u0000/g, "").replace(/\r\n?/g, "\n");
    text = escHtml(text).replace(FENCE, function (_, code) {
      return "\n" + hold('<pre class="code"><code>' + code.replace(/\n[ \t]*$/, "") + "</code></pre>") + "\n";
    });
    return blocks(text.split("\n")).join("").replace(HOLES, function (_, n) { return holes[+n]; });
  }

  // --- repo file viewer ----------------------------------------------------

  var cfg = null;
  var openToken = 0;

  var EXT_LANG = {
    py: "python", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
    ts: "javascript", tsx: "javascript", json: "javascript", rb: "ruby", pl: "perl",
    php: "markup", html: "markup", htm: "markup", xml: "markup", svg: "markup", vue: "markup",
    sh: "bash", bash: "bash", zsh: "bash", css: "css", scss: "css",
  };

  function grammarFor(path) {
    var name = String(path || "").split("/").pop().toLowerCase();
    var ext = name.indexOf(".") >= 0 ? name.split(".").pop() : "";
    return EXT_LANG[ext] || "none";
  }

  /* The same normalisation the server applies before it checks its allowlist. If these two ever
     disagree the link either 404s or never appears, so they are written to match. */
  function normalise(raw) {
    var t = String(raw == null ? "" : raw).trim();
    if (t.slice(0, 2) === "./") t = t.slice(2);
    while (t.length > 1 && t.charAt(t.length - 1) === "/") t = t.slice(0, -1);
    return t;
  }

  function configure(opts) {
    var o = opts || {};
    var set = Object.create(null);
    (o.paths || []).forEach(function (p) { set[normalise(p)] = true; });
    cfg = { paths: set, load: o.load, openOverlay: o.openOverlay, source: o.source || null };
  }

  function reset() { cfg = null; }

  function known(path) {
    return !!(cfg && cfg.paths[normalise(path)]);
  }

  /* Turn every <code> span naming a file this lesson cited into a button. Guarded and swallowing:
     the prose is already on screen and correct, and the links are an affordance on top of it. */
  function link(el) {
    if (!cfg || !el) return;
    try {
      var codes = el.querySelectorAll("code");
      for (var i = 0; i < codes.length; i++) {
        var code = codes[i];
        if (code.closest("pre") || code.closest("button")) continue;
        var path = normalise(code.textContent);
        if (!known(path)) continue;
        var btn = document.createElement("button");
        btn.className = "fileref";
        btn.type = "button";
        btn.title = "Open " + path;
        btn.setAttribute("data-path", path);
        // The file glyph is a CSS ::before, not an element. It is decoration, and an element
        // would put it in the clipboard in front of every path somebody copies.
        var label = document.createElement("code");
        label.textContent = code.textContent;
        btn.appendChild(label);
        btn.addEventListener("click", onClick);
        code.parentNode.replaceChild(btn, code);
      }
    } catch (e) { /* decoration; never cost the lesson */ }
  }

  function onClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    open(ev.currentTarget.getAttribute("data-path"));
  }

  function body() {
    var o = document.getElementById("overlay");
    return o ? o.querySelector(".overlay-body") : null;
  }

  function note(text, cls) {
    var p = document.createElement("p");
    p.className = cls || "muted";
    p.textContent = text;
    return p;
  }

  function open(path) {
    if (!cfg || !cfg.load || !cfg.openOverlay) return;
    var mine = ++openToken;
    // The title carries the path and both hosts escape it. The body is a fixed literal, so a
    // path can never reach an innerHTML sink through this call.
    cfg.openOverlay(path, '<p class="muted">opening\u2026</p>');
    Promise.resolve()
      .then(function () { return cfg.load(path); })
      .then(function (data) {
        if (mine !== openToken) return;      // they clicked another file while this was in flight
        var host = body();
        if (host) { host.innerHTML = ""; host.appendChild(render(path, data || {})); }
      })
      .catch(function (err) {
        if (mine !== openToken) return;
        var host = body();
        if (!host) return;
        host.innerHTML = "";
        host.appendChild(note(
          (err && err.message) || "That file could not be opened just now."));
      });
  }

  /* Built as DOM with textContent throughout. The content is somebody else's source code, so it
     never goes near innerHTML; Prism highlights an element whose text was already set, which is
     the same path editor.js takes. */
  function render(path, data) {
    var wrap = document.createElement("div");
    wrap.className = "rf";

    var head = document.createElement("div");
    head.className = "rf-head";
    var where = document.createElement("span");
    where.className = "rf-where mono";
    where.textContent = data.repo ? data.repo + " · " + (data.ref || "") : (cfg.source || "");
    head.appendChild(where);
    if (data.bytes) {
      var size = document.createElement("span");
      size.className = "rf-size mono";
      size.textContent = Math.max(1, Math.round(data.bytes / 1024)) + " KB";
      head.appendChild(size);
    }
    if (data.url) {
      var a = document.createElement("a");
      a.className = "rf-out";
      a.href = data.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "view on GitHub ↗";
      head.appendChild(a);
    }
    wrap.appendChild(head);

    var text = String(data.content == null ? "" : data.content);
    var lines = text.split("\n");
    var box = document.createElement("div");
    box.className = "rf-box";
    var gut = document.createElement("div");
    gut.className = "rf-gut mono";
    gut.setAttribute("aria-hidden", "true");
    var nums = [];
    for (var i = 1; i <= lines.length; i++) nums.push(i);
    gut.textContent = nums.join("\n");
    var pre = document.createElement("pre");
    pre.className = "rf-pre";
    var code = document.createElement("code");
    var g = grammarFor(path);
    code.className = "language-" + g;
    code.textContent = text;
    pre.appendChild(code);
    box.appendChild(gut);
    box.appendChild(pre);
    wrap.appendChild(box);

    try {
      var P = global.Prism;
      if (P && P.languages[g]) P.highlightElement(code);
    } catch (e) { /* unhighlighted is still readable */ }

    if (data.truncated) {
      wrap.appendChild(note("This file is longer than the viewer shows. The rest is on GitHub."));
    }
    return wrap;
  }

  global.CTProse = {
    splitOpener: splitOpener,
    toHtml: toHtml,
    configure: configure,
    reset: reset,
    known: known,
    link: link,
    open: open,
  };
})(typeof window !== "undefined" ? window : this);
