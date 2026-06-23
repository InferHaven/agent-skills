# InferHaven Agent Skills

Open agent skills from [InferHaven](https://inferhaven.com). Each skill is a
self-contained tool you can drop into Claude Code (or a compatible agent
runtime).

## Skills

### [`codetrain/`](./codetrain) — Socratic coding tutor

Learn on your own codebase, one tiny step at a time. CodeTrain runs a local
tutor that walks you through real code, has you type each line yourself, and
keeps a lightweight memory of what you have learned. Your code never leaves your
machine.

- **Install:** `cd codetrain && ./install.sh`
- **Then** restart Claude Code and say "teach me this code" or "walk me through
  this".
- **Details:** [`codetrain/README.md`](./codetrain/README.md).

The skill is free and single-player. Hosted plans (zero-setup managed access,
your real repos, cross-device sync, and the team dashboards) live at
[codetrain.ai](https://codetrain.ai).

## License

Apache License 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
Contributions are welcome under the [DCO](./CONTRIBUTING.md); there is no CLA.

CodeTrain and the InferHaven agent skills are products of
[InferHaven LLC](https://inferhaven.com).
