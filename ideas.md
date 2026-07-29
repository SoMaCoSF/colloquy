# Colloquy Roadmap & Feature Backlog

Tracking feature ideas, roadmap extensions, and birdwalk additions for **Colloquy in Herdr**.

---

## 🌲 1. Knowledge Graph & Causal Decision Walking
- [ ] **Interactive Decision Walker:** Full keyboard navigation through causal DAG nodes with live parent/child context inspection.
- [ ] **State Diffing View:** Side-by-side diff between two decision heartbeat states (`0x825`).
- [ ] **Counterfactual Replay Stepper:** Step backward and forward through decision trees to test alternative prompt strategies.

---

## 🐙 2. GitHub & Workspace Integrations
- [ ] **Export to Markdown (`.md`):** Generate structured session post-mortems and decision trees formatted for GitHub release notes or PR descriptions.
- [ ] **1-Click Gist Creation:** Keyboard shortcut (`G`) in LCARS TUI to instantly push session DAGs to GitHub Gists via `gh gist create`.
- [ ] **Mermaid.js Diagram Rendering:** Convert causal DAGs to `mermaid` flowcharts embedded inside exported `.md` files.

---

## 🌐 3. Swarm & Model Telemetry
- [ ] **ASCII Network Topology Map:** Live sub-agent connection status, model assignments, and latency metrics.
- [ ] **Prompt Cache Warmth Monitor:** Ephemeral 5-minute cache TTL visualization and token savings counter.
- [ ] **Herdr Socket Events:** Real-time event broadcasting over Herdr IPC multiplexer daemon.
