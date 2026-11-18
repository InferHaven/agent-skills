/* CodeTrain - the paper and light control, the ONE theme control on every page.

   The theme itself is applied by /app/theme.js, which every page loads synchronously in <head> so
   data-theme and data-palette are set before first paint. This file is only the control, deferred
   because nothing depends on it to render.

   Every [data-theme-toggle] button opens one small popover with two choices: the paper (the
   sheet's whole colour world) and the light (Auto, Light, Dark). It handles buttons that a page
   draws later, such as the lesson screen's head, by listening on the document and painting new
   buttons as they appear. A page without /sheet.css (the admin console) has no popover styles,
   so there the button keeps the old behaviour: each click moves Auto, Light, Dark.

   "Auto" follows the system and is the first choice on purpose: a plain two-way switch has no way
   back to it once touched. */
(function () {
  "use strict";

  var MODE_LABEL = { system: "Auto", light: "Light", dark: "Dark" };
  var PAPER_LABEL = { blueprint: "Blueprint", linen: "Linen", graphite: "Graphite" };
  // Drawn icons, one stroke weight: a moon for dark, a sun for light, a half-filled disc for
  // "follow the system".
  var ICONS = {
    dark: '<path d="M12.6 9.6A5 5 0 0 1 6.4 3.4a5 5 0 1 0 6.2 6.2z"/>',
    light: '<circle cx="8" cy="8" r="2.6"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>',
    system: '<circle cx="8" cy="8" r="5.4"/><path d="M8 2.6a5.4 5.4 0 0 0 0 10.8z" fill="currentColor" stroke="none"/>',
  };
  function icon(m) {
    return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[m] || ICONS.system) + "</svg>";
  }

  var menu = null;
  var opener = null;
  var NATIVE = typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype;

  function hasSheet() {
    try { return !!getComputedStyle(document.documentElement).getPropertyValue("--sheet").trim(); }
    catch (e) { return false; }
  }

  function describe() {
    var t = window.ctTheme;
    var paper = PAPER_LABEL[t.palette()] || PAPER_LABEL.blueprint;
    var light = MODE_LABEL[t.mode()] || MODE_LABEL.system;
    return "Paper and light: " + paper + ", " + light + ". Click to change.";
  }

  function paint(button) {
    var t = window.ctTheme;
    button.innerHTML = icon(t.mode());
    var words = menu || hasSheet() ? describe() : "Theme: " + (MODE_LABEL[t.mode()] || "Auto") + ". Click to change.";
    button.setAttribute("title", words);
    button.setAttribute("aria-label", words);
    if (hasSheet()) {
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-controls", "ct-paper");
      button.setAttribute("aria-expanded", menu && menu.classList.contains("is-open") ? "true" : "false");
      // The button is the popover's own invoker, so the browser does the opening and closing: a
      // second click closes it instead of being read as a click outside and reopening it, and
      // Tab from the button goes into the panel rather than to the end of the page.
      if (NATIVE) button.setAttribute("popovertarget", "ct-paper");
    }
  }
  function paintAll() {
    var nodes = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < nodes.length; i++) paint(nodes[i]);
  }

  function buildMenu() {
    var t = window.ctTheme;
    var papers = t.palettes || ["blueprint"];
    var html = '<fieldset><legend>Paper</legend><div class="paper-opts">';
    for (var i = 0; i < papers.length; i++) {
      var p = papers[i];
      html += '<label class="paper-opt"><input type="radio" name="ct-paper" value="' + p + '">'
        + '<span class="paper-sw" data-paper="' + p + '" aria-hidden="true"></span>'
        + "<span>" + (PAPER_LABEL[p] || p) + "</span></label>";
    }
    html += '</div></fieldset><fieldset><legend>Light</legend><div class="mode-opts">';
    var modes = ["system", "light", "dark"];
    for (var j = 0; j < modes.length; j++) {
      html += '<label class="mode-opt"><input type="radio" name="ct-mode" value="' + modes[j] + '">'
        + '<span class="mode-face">' + icon(modes[j]) + MODE_LABEL[modes[j]] + "</span></label>";
    }
    html += "</div></fieldset>";
    var el = document.createElement("div");
    el.id = "ct-paper";
    el.className = "paper-menu";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Paper and light");
    if (NATIVE) el.setAttribute("popover", "auto");
    else el.hidden = true;
    el.innerHTML = html;
    el.addEventListener("change", function (ev) {
      var input = ev.target;
      if (!input || input.type !== "radio") return;
      if (input.name === "ct-paper") window.ctTheme.setPalette(input.value);
      else if (input.name === "ct-mode") window.ctTheme.set(input.value);
      paintAll();
    });
    // Opening: show the current choices and sit under the button that asked.
    el.addEventListener("beforetoggle", function (ev) {
      if (ev.newState !== "open") return;
      syncChoices();
      if (opener) place(opener);
    });
    el.addEventListener("toggle", function (ev) {
      var open = ev.newState === "open";
      el.classList.toggle("is-open", open);
      if (opener) opener.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        var first = el.querySelector("input[name=ct-paper]:checked") || el.querySelector("input");
        if (first) first.focus();
      } else if (opener && document.activeElement && (document.activeElement === document.body || el.contains(document.activeElement))) {
        opener.focus();
      }
    });
    document.body.appendChild(el);
    return el;
  }

  function syncChoices() {
    var t = window.ctTheme;
    var checks = menu.querySelectorAll("input[type=radio]");
    for (var i = 0; i < checks.length; i++) {
      var c = checks[i];
      c.checked = c.name === "ct-paper" ? c.value === t.palette() : c.value === t.mode();
    }
  }

  // Under the button that opened it, kept inside the viewport.
  function place(button) {
    var r = button.getBoundingClientRect();
    // Measured before it is shown, so the width comes from the stylesheet's own rule, not from
    // the box (which is zero while closed).
    var w = Math.min(268, window.innerWidth - 16);
    var left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    menu.style.top = Math.round(r.bottom + 8) + "px";
    menu.style.left = Math.round(left) + "px";
  }

  // Only for a browser without the popover API: the same panel, shown and hidden by hand.
  function toggleByHand(button) {
    opener = button;
    syncChoices();
    menu.hidden = !menu.hidden;
    menu.classList.toggle("is-open", !menu.hidden);
    button.setAttribute("aria-expanded", menu.hidden ? "false" : "true");
    if (menu.hidden) return;
    place(button);
    var first = menu.querySelector("input[name=ct-paper]:checked") || menu.querySelector("input");
    if (first) first.focus();
  }

  function wire() {
    var t = window.ctTheme;
    // theme.js is loaded synchronously ahead of this file, so ctTheme is normally already there.
    // If it is missing (blocked, failed to load) every button would change nothing, so remove them
    // rather than leave a control that silently does nothing when clicked.
    if (!t) {
      var dead = document.querySelectorAll("[data-theme-toggle]");
      for (var i = 0; i < dead.length; i++) dead[i].remove();
      return;
    }
    var popover = hasSheet() && !!t.palettes;
    // Built now, not on first use, so every button can name it as its popover target.
    if (popover) menu = buildMenu();
    // A click only records WHICH button opened the panel (several pages have two); the browser's
    // popover handling does the opening, after this listener has run.
    document.addEventListener("click", function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest("[data-theme-toggle]") : null;
      if (!b) {
        // The hand-made fallback closes on a click outside, as a popover does.
        if (popover && !NATIVE && !menu.hidden && !menu.contains(ev.target)) { menu.hidden = true; menu.classList.remove("is-open"); }
        return;
      }
      if (!popover) { t.cycle(); paintAll(); return; }
      opener = b;
      if (!NATIVE) toggleByHand(b);
    });
    if (popover) {
      window.addEventListener("resize", function () { if (opener && menu.classList.contains("is-open")) place(opener); });
      document.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape" && !NATIVE && !menu.hidden) { menu.hidden = true; menu.classList.remove("is-open"); if (opener) opener.focus(); }
      });
    }
    document.addEventListener("ct:theme", paintAll);
    // Buttons a page draws after this runs (the lesson screen re-renders its head) get painted too.
    if (typeof MutationObserver === "function") {
      new MutationObserver(function (records) {
        for (var r = 0; r < records.length; r++) {
          var added = records[r].addedNodes;
          for (var a = 0; a < added.length; a++) {
            var n = added[a];
            if (n.nodeType !== 1) continue;
            if (n.matches && n.matches("[data-theme-toggle]")) paint(n);
            var inner = n.querySelectorAll ? n.querySelectorAll("[data-theme-toggle]") : [];
            for (var k = 0; k < inner.length; k++) paint(inner[k]);
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    }
    paintAll();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
