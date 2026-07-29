# Colloquy — Causal DAG Audit Logs & Telemetry for Agent Swarms

Colloquy turns sustained multi-agent sessions into typed, self-addressing, DAG-shaped, replayable, forkable, and auditable artifacts.

Every decision, tool call, model route, and retraction is anchored to bit-packed 128-bit UUIDs (`scheme_v=1`), encoding telemetry and topology directly into the identifier bits without expensive database joins.

Designed as both a **standalone agent skill** and a **native Herdr terminal multiplexer plugin**.

## Key Features

- **Self-Addressing Causal DAGs** — Every turn and decision point (heartbeat) receives a typed 128-bit UUID:  
  `0x009` COLLOQUY · `0x00A` SESSION · `0x005` TURN · `0x825` HEARTBEAT
- **5-Minute Ephemeral Cache Optimization** — Tracks Anthropic prompt-caching windows (`cache_warm_until = completed_at + 300_000 ms`) for up to **6.35×** token savings during interactive pairing.
- **Counterfactual Decision Forking** — Spawn child colloquies from any past decision heartbeat while retaining full causal history.
- **Subagent Governance & Circuit Breakers** — Bit-packed `spawn_depth` enforces hard limits (e.g. depth ≤ 15) and applies an epistemic trust discount:  
  \(\text{trust} = \text{signal} \times (1 - \epsilon)^d\)
- **Star Trek LCARS Mission Control** — 24-bit ANSI LCARS terminal UI for multiplexer overlay panes (`somaco.colloquy.lcars`).
- **Turso / SQLite Edge Sync** — Lightweight schema with automated triggers for cache-ratio rollups, turn counts, and cost accounting.

## Architecture Overview
