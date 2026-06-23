# Security Policy

Thanks for helping keep the InferHaven agent skills and their users safe.

This policy covers the skills in this repository, primarily **codetrain** — a
local-first coding tutor that runs a loopback web server on your machine, applies
small edits to files in a workspace you choose, and runs code in your browser via
Pyodide.

## Reporting a vulnerability

**Please do not open public issues, pull requests, or discussions for security
vulnerabilities.** Disclosing a flaw before a fix is available puts users at risk.

Report privately instead, either:

- **GitHub Private Vulnerability Reporting** (preferred): the *Report a
  vulnerability* button under this repository's **Security** tab.
- **Email:** [lookout@inferhaven.com](mailto:lookout@inferhaven.com)

If your report includes credentials, tokens, or working exploit code, encrypt it
to the InferHaven OpenPGP key (fingerprint
`4992 80D5 D75E 3A4F 837C  6A68 85D8 E097 0D05 CEC0`, published in the
[inferhaven-core](https://github.com/InferHaven/inferhaven-core) repository) and
never include live secrets in an unencrypted message.

We aim to acknowledge a report within a few business days and will keep you
updated as we work on a fix.

## Supported versions

The skill is distributed source-only; we support the latest commit on `main`.
Fixes land there.

## Scope

In scope (genuine vulnerabilities we want to hear about):

- The local tutor server (`app/server.py`) binding to anything other than
  loopback, path traversal, or serving files outside its intended directory.
- Arbitrary file write or escape beyond the chosen workspace via the patch
  applier (`app/patch.py`).
- Cross-site scripting or sandbox escape in the in-browser editor/runner.
- A local cross-origin or CSRF path that lets another origin or process drive the
  loopback server.

By design, and therefore **not** vulnerabilities on their own:

- The skill reads and writes files in the workspace you point it at — that is its
  job.
- It runs code you provide, locally, on your machine and in your browser.
- It uses your own AI agent and key; it does not phone home or send your code
  anywhere.

## A note on secrets

This is a single-player, bring-your-own-key tool: it should never contain or
require a server-side secret. If you ever find an embedded credential in this
repository, treat it as a vulnerability and report it privately.
