/* CodeTrain - the first-paint script. Loaded synchronously in <head> of every page, so <html>
   carries its theme and its paper BEFORE first paint (no flash). CSP-safe: a same-origin script
   (script-src 'self'), no inline code.

   It stamps three attributes, all read by web/sheet.css:
   - data-theme, the RESOLVED mode ("light" or "dark", never "system");
   - data-palette, the paper ("linen", "graphite", ...). No attribute means Blueprint, the default,
     so a visitor who never chose anything gets exactly the site as designed;
   - data-visitor="returning" once an account has been used in this browser, so every page can
     offer Dashboard instead of Start free before it paints, with no network call.

   `ct:returning` IS DECLARED HERE AND NOWHERE ELSE. It moved from auth.js (2026-11-18) because the
   public pages need it before first paint and never load auth.js; auth.js borrows it from here, so
   the dashboard's sign-up-or-sign-in choice and the rail read one answer.
   test_onboarding_entry.py refuses a second spelling anywhere under web/.

   One storage key each, for the whole site, so a choice made on the home page holds in the
   dashboard and on the lesson screen. web/theme-toggle.js is the one control that changes them. */
(function () {
  var KEY = "ct-app-theme"; // "system" | "light" | "dark"
  var PALETTE_KEY = "ct-app-palette";
  // The papers this site ships. A stored value that is no longer one of them (a paper retired, a
  // hand-edited key) falls back to the default rather than leaving the sheet without its colours.
  var PALETTES = ["blueprint", "linen", "graphite"];
  var DEFAULT_PALETTE = "blueprint";
  // "An account has been used in this browser": written the first time a dashboard page is reached
  // signed in. Storage blocked reads as "not returning", the safe direction: a stranger is the
  // common case on a fresh profile, and a returning learner offered Start free clicks once more.
  var RETURNING_KEY = "ct:returning";
  var mql = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  // What "no stored choice yet" means, per page. The signed-in app follows the OS, which is the
  // respectful default for something you sit inside for an hour. The public pages opt out with
  // <html data-theme-default="dark"> because dark is the brand and a visitor arriving on a light
  // OS should still see the site as designed until they ask for otherwise. Once anyone picks a
  // mode the stored value wins everywhere and this stops mattering.
  function fallbackMode() {
    try {
      return document.documentElement.getAttribute("data-theme-default") || "system";
    } catch (e) { return "system"; }
  }
  function mode() {
    try { return localStorage.getItem(KEY) || fallbackMode(); } catch (e) { return fallbackMode(); }
  }
  function palette() {
    var p = null;
    try { p = localStorage.getItem(PALETTE_KEY); } catch (e) { /* blocked storage: the default */ }
    return PALETTES.indexOf(p) >= 0 ? p : DEFAULT_PALETTE;
  }
  function isReturning() {
    try { return localStorage.getItem(RETURNING_KEY) === "1"; } catch (e) { return false; }
  }
  function stampVisitor() {
    try {
      if (isReturning()) document.documentElement.setAttribute("data-visitor", "returning");
    } catch (e) {}
  }
  function markReturning() {
    try { localStorage.setItem(RETURNING_KEY, "1"); } catch (e) { /* private mode: offer Sign up again */ }
    stampVisitor();
  }
  function resolve(m) { return m === "system" ? (mql && mql.matches ? "dark" : "light") : m; }
  function apply() {
    var next = resolve(mode());
    var paper = palette();
    try {
      var root = document.documentElement;
      root.setAttribute("data-theme", next);
      if (paper === DEFAULT_PALETTE) root.removeAttribute("data-palette");
      else root.setAttribute("data-palette", paper);
    } catch (e) {}
    // Anything that has to repaint itself for the new theme or paper listens for this. CSS handles
    // itself; canvas does not: rain.js reads its colour ramp from the paper's tokens here.
    // Guarded: this runs from <head> before first paint, so on the very first call the document
    // may have no body yet and dispatching would throw on some engines.
    try {
      if (document.body) {
        document.dispatchEvent(new CustomEvent("ct:theme", { detail: { theme: next, palette: paper } }));
      }
    } catch (e) { /* CustomEvent unsupported: the ramp just stays as loaded */ }
  }
  function set(m) {
    try { localStorage.setItem(KEY, m); } catch (e) {}
    apply();
  }
  function setPalette(p) {
    if (PALETTES.indexOf(p) < 0) return;
    try {
      if (p === DEFAULT_PALETTE) localStorage.removeItem(PALETTE_KEY);
      else localStorage.setItem(PALETTE_KEY, p);
    } catch (e) {}
    apply();
  }
  function cycle() {
    var order = ["system", "light", "dark"];
    set(order[(order.indexOf(mode()) + 1) % order.length]);
  }
  apply();
  stampVisitor();
  // Follow the OS while in "system".
  if (mql && mql.addEventListener) mql.addEventListener("change", function () { if (mode() === "system") apply(); });
  window.ctTheme = {
    mode: mode, set: set, cycle: cycle, apply: apply,
    palette: palette, setPalette: setPalette, palettes: PALETTES.slice(),
    visitor: { isReturning: isReturning, mark: markReturning },
  };
})();
