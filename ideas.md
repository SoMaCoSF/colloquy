# Colloquy Roadmap & Feature Backlog

Tracking feature ideas, roadmap extensions, and birdwalk additions for **Colloquy in Herdr**.

---

## 🌲 1. Knowledge Graph & Causal Decision Walking
- [ ] **Interactive Decision Walker:** Full keyboard navigation through causal DAG nodes with live parent/child context inspection.
- [x] **State Diffing View:** (Slurped -> docs/state-diffing-view.md) Side-by-side diff between two decision heartbeat states (`0x825`).
- [ ] **Counterfactual Replay Stepper:** Step backward and forward through decision trees to test alternative prompt strategies.

---

## 🐙 2. GitHub & Workspace Integrations
- [x] **Export to Markdown (`.md`):** (Slurped -> docs/export-to-markdown-md.md) Generate structured session post-mortems and decision trees formatted for GitHub release notes or PR descriptions.
- [x] **1-Click Gist Creation:** (Slurped -> docs/1-click-gist-creation.md) Keyboard shortcut (`G`) in LCARS TUI to instantly push session DAGs to GitHub Gists via `gh gist create`.
- [ ] **Mermaid.js Diagram Rendering:** Convert causal DAGs to `mermaid` flowcharts embedded inside exported `.md` files.

---

## 🌐 3. Swarm & Model Telemetry
- [x] **ASCII Network Topology Map:** (Implemented -> lib/ascii-network-topology-map.mjs) Live sub-agent connection status, model assignments, and latency metrics.
- [ ] **Prompt Cache Warmth Monitor:** Ephemeral 5-minute cache TTL visualization and token savings counter.
- [ ] **Herdr Socket Events:** Real-time event broadcasting over Herdr IPC multiplexer daemon.
