/* CodeTrain — lesson visuals: trace, flow, compare.

   These are the data-driven half of the DEMOS registry in study.js. `tokenizer` and `attention`
   are bespoke widgets for one course; these three take a spec and draw whatever it describes, so
   any lesson can ask for a picture without anyone writing a new renderer. The tutor may attach
   one to its feedback after a submission (see services/tutor_engine.py::_delta_for), and a
   curated reading step may declare one in courses.py.

   THE RULE THAT MATTERS: a spec is data, never markup. Every string here reaches the document
   through textContent or a DOM property, and nothing in this file concatenates a spec value into
   an HTML or SVG string. The server validator (services/visuals.py) rejects tag-like strings
   before they get here; this file is written so that it would still be safe if it did not. The
   study page runs with 'unsafe-eval' and 'unsafe-inline' style for Pyodide, so an injection here
   would be an unusually expensive one.

   All three degrade to nothing rather than throwing: a picture is an aid, and a broken aid must
   never take the lesson down with it. mountDemo already try/catches, this is the second lock. */

const SVG_NS = "http://www.w3.org/2000/svg";

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const key in attrs) node.setAttribute(key, String(attrs[key]));
  return node;
}

function shell(host, spec, kind) {
  host.textContent = "";
  const box = el("div", `vis vis-${kind}`);
  if (spec.title) box.appendChild(el("div", "vis-h mono", spec.title));
  host.appendChild(box);
  return box;
}

/* Wrap a label into at most `maxLines` lines of roughly `perLine` characters. SVG has no text
   wrapping, so a long node label would otherwise run straight out of its box and over the next
   one. Breaking on words keeps it readable; the ellipsis is honest about the truncation. */
function wrap(text, perLine, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > perLine && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines) {
    const used = lines.join(" ").split(/\s+/).length;
    if (used < words.length) lines[maxLines - 1] = `${lines[maxLines - 1]}…`;
  }
  return lines.length ? lines : [""];
}

// --- trace: state changing, one frame at a time -----------------------------------------------

export function mountTrace(host, spec) {
  const frames = spec && spec.frames;
  if (!Array.isArray(frames) || !frames.length) return;
  const box = shell(host, spec, "trace");

  const nav = el("div", "vis-nav");
  const prev = el("button", "vis-btn", "‹");
  const next = el("button", "vis-btn", "›");
  const count = el("span", "vis-count mono");
  prev.type = next.type = "button";
  prev.setAttribute("aria-label", "Previous frame");
  next.setAttribute("aria-label", "Next frame");
  nav.append(prev, count, next);

  const caption = el("div", "vis-cap");
  const grid = el("div", "vis-grid");
  box.append(nav, caption, grid);

  let at = 0;
  const draw = () => {
    const frame = frames[at] || {};
    count.textContent = `${at + 1} / ${frames.length}`;
    const line = frame.line ? `line ${frame.line}` : "";
    caption.textContent = [line, frame.caption].filter(Boolean).join(" · ");
    caption.style.display = caption.textContent ? "" : "none";

    // Diffing against the previous frame is the entire point of a trace: the learner should be
    // able to see WHICH value moved without reading all twelve of them.
    const before = at > 0 ? (frames[at - 1] || {}).values || {} : null;
    grid.textContent = "";
    const values = frame.values || {};
    for (const name in values) {
      const changed = before && before[name] !== values[name];
      const row = el("div", `vis-row${changed ? " changed" : ""}`);
      row.append(el("span", "vis-name mono", name), el("span", "vis-val mono", values[name]));
      grid.appendChild(row);
    }
    prev.disabled = at === 0;
    next.disabled = at === frames.length - 1;
  };

  prev.onclick = () => { if (at > 0) { at -= 1; draw(); } };
  next.onclick = () => { if (at < frames.length - 1) { at += 1; draw(); } };
  draw();
}

// --- flow: how the parts connect ---------------------------------------------------------------

/* Every number here sits on a 4px grid, and the boxes are sized from their CONTENT rather than
   fixed. A single BOX_W meant a column of `req` and `res` wasted two thirds of its width while
   `logger(req, res, next)` was wrapped to two lines and then truncated with an ellipsis -- in a
   diagram whose entire job is naming the parts. MIN_W keeps a one-word column from collapsing and
   MAX_W keeps one long label from pushing the whole picture into a horizontal scroll.

   CH is a measurement, not a guess: JetBrains Mono at 12px advances 7.2px per character, and every
   fallback in --mono is also a fixed-pitch face at roughly that ratio. It only decides how wide to
   draw the box, so being a little generous costs whitespace and never a clipped word. */
const BOX_H = 48, GAP_X = 56, GAP_Y = 20, PAD = 8;
const MIN_W = 96, MAX_W = 208, PAD_X = 14, CH = 7.2, MAX_LINES = 2;

function grid4(n) { return Math.max(4, Math.round(n / 4) * 4); }

/* How wide this column has to be: the narrowest it can get away with and still show every label
   in full. Estimating it from the label LENGTH does not work, because a two-line wrap breaks on
   word boundaries and words are not evenly sized -- `log 'Handler reached'` is 21 characters and
   needs 12 per line, not 11, because the break has to fall after `'Handler`. So ask `wrap` itself
   and shrink until it stops fitting. One definition of "fits", and it is the one that renders.

   The floor is the longest single word: `wrap` never breaks inside one, so going below that would
   trade an ellipsis for an overflow. Hitting MAX_W on a genuinely huge identifier is the one case
   that still overflows slightly, and that is the right way round -- a clipped name is unreadable
   where a name poking past its box is merely untidy. */
function fits(label, chars) {
  const lines = wrap(label, chars, MAX_LINES);
  return !lines[lines.length - 1].endsWith("\u2026");
}

function columnWidth(column) {
  const maxChars = Math.floor((MAX_W - PAD_X * 2) / CH);
  const minChars = Math.ceil((MIN_W - PAD_X * 2) / CH);
  let chars = minChars;
  for (const node of column) {
    const label = String(node.label == null ? "" : node.label);
    const longestWord = Math.min(maxChars,
      label.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0));
    const floor = Math.max(minChars, longestWord);
    let need = Math.min(Math.max(label.length, floor), maxChars);
    while (need > floor && fits(label, need - 1)) need -= 1;
    chars = Math.max(chars, need);
  }
  return Math.max(MIN_W, Math.min(MAX_W, grid4(chars * CH + PAD_X * 2)));
}

/* Layer each node one step past its deepest predecessor, so arrows read left to right. Cycles
   are possible in anything a model wrote, so the relaxation is capped at one pass per node and
   anything still unplaced lands in layer 0 rather than looping forever. */
function layerNodes(nodes, edges) {
  const layer = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let moved = false;
    for (const edge of edges) {
      if (edge.from === edge.to) continue;
      const want = layer.get(edge.from) + 1;
      if (want > layer.get(edge.to)) { layer.set(edge.to, want); moved = true; }
    }
    if (!moved) break;
  }
  const columns = [];
  for (const node of nodes) {
    const idx = layer.get(node.id) || 0;
    (columns[idx] = columns[idx] || []).push(node);
  }
  return columns.filter(Boolean);
}

export function mountFlow(host, spec) {
  const nodes = spec && spec.nodes;
  const edges = (spec && spec.edges) || [];
  if (!Array.isArray(nodes) || !nodes.length) return;
  const box = shell(host, spec, "flow");

  const columns = layerNodes(nodes, edges);
  const tallest = Math.max(...columns.map((c) => c.length));
  const widths = columns.map(columnWidth);
  const width = widths.reduce((a, w) => a + w, 0) + (columns.length - 1) * GAP_X + PAD * 2;
  const height = tallest * BOX_H + (tallest - 1) * GAP_Y + PAD * 2;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`, class: "vis-svg", role: "img",
    "aria-label": spec.title || "Diagram",
  });

  const defs = svgEl("defs");
  const marker = svgEl("marker", {
    id: "vis-arrow", viewBox: "0 0 8 8", refX: 7, refY: 4,
    markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse",
  });
  marker.appendChild(svgEl("path", { d: "M0 0 L8 4 L0 8 z", class: "vis-arrowhead" }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  const at = new Map();
  let cx = PAD;
  columns.forEach((column, ci) => {
    const colH = column.length * BOX_H + (column.length - 1) * GAP_Y;
    column.forEach((node, ri) => {
      const y = PAD + (height - PAD * 2 - colH) / 2 + ri * (BOX_H + GAP_Y);
      at.set(node.id, { x: cx, y, w: widths[ci] });
    });
    cx += widths[ci] + GAP_X;
  });

  /* Edges first so a box always sits on top of its own arrows.

     Labels used to go at the bezier's midpoint and nowhere else, so two edges spanning the same
     pair of columns printed one word on top of another -- and "next() triggers" over "calls" is
     unreadable in exactly the diagram that was drawn to explain the difference. Each label now
     takes the first free slot in a 15px ladder at its own x, and sits on a plate so it reads over
     the curve it belongs to rather than through it. */
  const taken = [];
  for (const edge of edges) {
    const a = at.get(edge.from), b = at.get(edge.to);
    if (!a || !b) continue;
    const x1 = a.x + a.w, y1 = a.y + BOX_H / 2;
    const x2 = b.x, y2 = b.y + BOX_H / 2;
    const mid = (x1 + x2) / 2;
    svg.appendChild(svgEl("path", {
      d: `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`,
      class: "vis-edge", "marker-end": "url(#vis-arrow)",
    }));
    if (!edge.label) continue;
    let ly = (y1 + y2) / 2 - 7;
    while (taken.some((t) => Math.abs(t.x - mid) < 40 && Math.abs(t.y - ly) < 13)) ly -= 15;
    taken.push({ x: mid, y: ly });
    const label = String(edge.label);
    const w = grid4(label.length * 6.3 + 10);
    svg.appendChild(svgEl("rect", {
      x: mid - w / 2, y: ly - 10, width: w, height: 14, rx: 4, class: "vis-edge-plate",
    }));
    const text = svgEl("text", { x: mid, y: ly, class: "vis-edge-t", "text-anchor": "middle" });
    text.textContent = label;
    svg.appendChild(text);
  }

  /* ONE FOCAL BOX AT MOST. Every node rendered identically, so a six-box diagram said nothing
     about which box the step is actually about -- the reader has to find that in the prose and
     carry it back. `focus` is a field the server caps at one (services/visuals.py::_flow), so this
     cannot become a diagram where everything is emphasised and therefore nothing is. */
  for (const node of nodes) {
    const pos = at.get(node.id);
    if (!pos) continue;
    const focal = node.focus === true;
    svg.appendChild(svgEl("rect", {
      x: pos.x, y: pos.y, width: pos.w, height: BOX_H, rx: 10,
      class: focal ? "vis-node focus" : "vis-node",
    }));
    const lines = wrap(node.label, Math.floor((pos.w - PAD_X * 2) / CH), MAX_LINES);
    lines.forEach((line, i) => {
      const text = svgEl("text", {
        x: pos.x + pos.w / 2,
        y: pos.y + BOX_H / 2 + (i - (lines.length - 1) / 2) * 13 + 4,
        class: focal ? "vis-node-t focus" : "vis-node-t", "text-anchor": "middle",
      });
      text.textContent = line;
      svg.appendChild(text);
    });
  }

  const scroll = el("div", "vis-scroll");
  scroll.appendChild(svg);
  box.appendChild(scroll);
}

// --- compare: before and after ------------------------------------------------------------------

const STATUS_MARK = { same: "", changed: "~", added: "+", removed: "−" };

export function mountCompare(host, spec) {
  const rows = spec && spec.rows;
  if (!Array.isArray(rows) || !rows.length) return;
  const box = shell(host, spec, "compare");

  const table = el("div", "vis-cmp");
  if (spec.left_label || spec.right_label) {
    const head = el("div", "vis-cmp-row head");
    head.append(
      el("span", "vis-cmp-mark", ""),
      el("span", "vis-cmp-cell mono", spec.left_label || ""),
      el("span", "vis-cmp-cell mono", spec.right_label || ""),
    );
    table.appendChild(head);
  }
  for (const row of rows) {
    const status = STATUS_MARK[row.status] === undefined ? "same" : row.status;
    const line = el("div", `vis-cmp-row ${status}`);
    line.append(
      el("span", "vis-cmp-mark mono", STATUS_MARK[status]),
      el("span", "vis-cmp-cell mono", row.left || ""),
      el("span", "vis-cmp-cell mono", row.right || ""),
    );
    table.appendChild(line);
  }
  box.appendChild(table);
}

// --- table: a small reference grid ---------------------------------------------------------------

export function mountTable(host, spec) {
  const headers = spec && spec.headers;
  const rows = spec && spec.rows;
  if (!Array.isArray(headers) || !headers.length || !Array.isArray(rows) || !rows.length) return;
  const box = shell(host, spec, "table");

  // A real <table>, because this IS tabular data: it gets row/column semantics for a screen
  // reader for free, which a grid of divs would have to reconstruct with ARIA and usually does
  // not. Every string still lands through textContent (see el), never as markup.
  const table = el("table", "vis-table");
  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  for (const head of headers) {
    const th = document.createElement("th");
    th.textContent = head == null ? "" : String(head);
    hrow.appendChild(th);
  }
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const tr = document.createElement("tr");
    for (let i = 0; i < headers.length; i += 1) {
      const td = document.createElement("td");
      td.className = "mono";
      td.textContent = row[i] == null ? "" : String(row[i]);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  box.appendChild(table);
}

/* Keyed exactly as `widget` arrives from the server, so study.js can spread this straight into
   DEMOS and a spec names its own renderer. Adding a widget is a deliberate act in two files:
   here and services/visuals.py's WIDGETS. */
export const VISUALS = { trace: mountTrace, flow: mountFlow, compare: mountCompare, table: mountTable };
