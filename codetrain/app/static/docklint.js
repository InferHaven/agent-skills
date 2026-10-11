/* Dockerfile linter — a small hadolint-style rule subset, pure and dependency-free.
   Runs client-side on both surfaces (managed study page + the agent's engine UI —
   engine/app/static/docklint.js is a byte-identical copy; the bundle build verifies).
   Dockerfile lessons are NEVER executed: these findings + the tutor's simulated build
   narration are the whole feedback loop. */
(function (global) {
  "use strict";

  const SECRET_NAME = /(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|CREDENTIAL)/i;

  // Fold "\"-continued lines into one logical instruction, remembering the first line number.
  function instructions(text) {
    const out = [];
    const lines = String(text || "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const startLine = i + 1;
      while (line.trimEnd().endsWith("\\") && i + 1 < lines.length) {
        line = line.trimEnd().slice(0, -1) + " " + lines[++i];
      }
      const m = line.trim().match(/^([A-Za-z]+)\s+([\s\S]*)$/);
      if (!m) continue;
      out.push({ line: startLine, op: m[1].toUpperCase(), args: m[2].trim() });
    }
    return out;
  }

  function dockLint(text) {
    const findings = [];
    const add = (line, rule, msg) => findings.push({ line, rule, msg });
    const ins = instructions(text);
    let cmdCount = 0, entryCount = 0, sawUser = false, sawFrom = false;

    for (const { line, op, args } of ins) {
      if (op === "FROM") {
        sawFrom = true;
        const image = args.split(/\s+/)[0];
        if (!image.includes("@sha256:") && (!image.includes(":") || image.endsWith(":latest"))) {
          add(line, "latest-tag", "Pin the base image to a version tag (`FROM node:20-alpine`) — untagged/:latest builds change under you.");
        }
      }
      if (op === "ADD" && !/^(https?:\/\/|.*\.(tar|tar\.gz|tgz|tar\.bz2|tar\.xz)\b)/.test(args)) {
        add(line, "add-vs-copy", "Use COPY for local files — ADD's extra powers (URL fetch, auto-extract) make builds surprising.");
      }
      if (op === "RUN") {
        if (/apt-get\s+install/.test(args) && !/rm\s+-rf\s+\/var\/lib\/apt\/lists/.test(args)) {
          add(line, "apt-cleanup", "Clean the apt cache in the same layer (`&& rm -rf /var/lib/apt/lists/*`) or it ships in the image.");
        }
        if (/apk\s+add\b/.test(args) && !/--no-cache/.test(args)) {
          add(line, "apk-no-cache", "Use `apk add --no-cache` so the index isn't baked into the layer.");
        }
        if (/apt(-get)?\s+(dist-)?upgrade/.test(args)) {
          add(line, "no-upgrade", "Don't upgrade the whole OS in a layer — bump the base image tag instead (reproducible + smaller).");
        }
      }
      if (op === "CMD") {
        cmdCount++;
        if (!args.trimStart().startsWith("[")) add(line, "json-form", "Prefer JSON (exec) form — `CMD [\"cmd\", \"arg\"]` — so signals reach your process, not a shell.");
      }
      if (op === "ENTRYPOINT") {
        entryCount++;
        if (!args.trimStart().startsWith("[")) add(line, "json-form", "Prefer JSON (exec) form — `ENTRYPOINT [\"cmd\"]` — so signals reach your process, not a shell.");
      }
      if (op === "USER") {
        sawUser = true;
        if (args.split(/\s+/)[0] === "root") add(line, "root-user", "Running as root defeats the point of USER — switch to an unprivileged user.");
      }
      if ((op === "ENV" || op === "ARG") && SECRET_NAME.test(args)) {
        add(line, "secret-in-image", "Never bake secrets into an image — ENV/ARG values persist in layers and `docker history`. Use runtime secrets.");
      }
      if (op === "WORKDIR" && !args.startsWith("/") && !args.startsWith("$")) {
        add(line, "workdir-relative", "Use an absolute WORKDIR — relative paths compound across instructions.");
      }
    }
    if (cmdCount > 1) add(0, "multiple-cmd", "Only the last CMD takes effect — remove the extras.");
    if (entryCount > 1) add(0, "multiple-cmd", "Only the last ENTRYPOINT takes effect — remove the extras.");
    if (sawFrom && !sawUser) add(0, "no-user", "No USER instruction — the container runs as root. Add an unprivileged user before CMD.");
    return findings;
  }

  global.dockLint = dockLint;
  if (typeof module !== "undefined" && module.exports) module.exports = { dockLint };
})(typeof window !== "undefined" ? window : globalThis);
