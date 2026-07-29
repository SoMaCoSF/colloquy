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

## Architecture Overview## Architecture Overview
┌────────────────────────────────────────────────────────────────────────────┐
│                             HERDR MULTIPLEXER                              │
│                                                                            │
│   ┌───────────────────────────┐          ┌─────────────────────────────┐   │
│   │ Pane 1: Claude Code       │          │ Pane 2: Sub-Agent Swarm     │   │
│   │ (Depth 0 - Root)          │          │ (Depth 1 - Delegated Worker)│   │
│   └─────────────┬─────────────┘          └──────────────┬──────────────┘   │
│                 │                                       │                  │
│                 └───────────────────┬───────────────────┘                  │
│                                     │ Live Streams / Terminal Telemetry    │
│                                     ▼                                      │
│               ┌───────────────────────────────────────────┐                │
│               │   Herdr Socket API (HERDR_SOCKET_PATH)  │                │
│               └─────────────────────┬─────────────────────┘                │
└─────────────────────────────────────┼──────────────────────────────────────┘
│
▼
┌────────────────────────────────────────────────────────────────────────────┐
│                           COLLOQUY DAEMON & ENGINE                         │
│                                                                            │
│ • Bit-packs telemetry into GYST 128-bit UUIDs                              │
│ • Maintains rolling 5-minute prompt cache TTL                              │
│ • Writes ACID rows to Turso / SQLite (colloquy-tables.sql)               │
│ • Drives LCARS Mission Control Overlay (somaco.colloquy.lcars)           │
└────────────────────────────────────────────────────────────────────────────┘
text## Installation

### Option 1 — Herdr Marketplace

```bash
herdr plugin install somacosf/colloquy
Option 2 — Local Development Link
Bashgit clone https://github.com/somacosf/colloquy.git
cd colloquy
npm install
herdr plugin link .
Usage & Commands
Herdr Actions (Ctrl+P or CLI)
Action IDTitleContextDescriptionsomaco.colloquy.mintColloquy: Mint Session (0x009)Workspace / PaneMints a new 0x009 Colloquy UUID + party sessionssomaco.colloquy.forkColloquy: Counterfactual ForkPaneForks active session at a decision nodesomaco.colloquy.view-lcarsColloquy: Toggle LCARS DashboardWorkspaceToggles the 24-bit LCARS overlay
Bash# Mint a new session
herdr plugin action invoke somaco.colloquy.mint -- --skill "system-refactor" --parties "somaco,vertex"

# Open the LCARS Mission Control Overlay
herdr plugin action invoke somaco.colloquy.view-lcars
CLI Utilities
1. Mint a Colloquy
Bashnode bin/mint.mjs --skill "codebook-audit" --parties "somaco,vertex" --telemetry heartbeat
2. Emit Decision Heartbeats
Bashnode bin/heartbeat.mjs <colloquy_uuid> plan_branch "optimizing_index_strategy" --signal 0xE666
3. Counterfactual Fork
Bashnode bin/fork.mjs <heartbeat_uuid> --skill "alternate-plan" --context '{"strategy":"in-memory"}'
4. LCARS Mission Control TUI
Bash# Non-interactive roster dump
node bin/lcars-tui.mjs --list

# Launch full terminal UI
node bin/lcars-tui.mjs
Database Schema & Storage
Defined in schema/colloquy-tables.sql (Turso / SQLite):

TablePurposeagentsRegistry of human operators and agent principalscolloquiesTop-level DAG headers (telemetry_mode, cache_warm_until, token rollups)agent_sessionsSession UUID derived for each party joining a colloquyturnsIndividual messages / model turns with token usage & cache accountingheartbeatsCausal DAG nodes (tool calls, skill invokes, confidence shifts, retractions)colloquy_forksLineage mapping between parent decision heartbeats and child colloquies
GYST 128-Bit UUID Bit Layout (scheme_v=1)
text┌───────────┬──────────────┬─────────────┬─────────────────┬──────────────────────┐
│ Prefix    │ Type Code    │ Domain/Prov │ Timestamp/Nonce │ Embedded Telemetry   │
│ (16 bits) │ (12 bits)    │ (8 bits)    │ (52 bits)       │ Payload (42 bits)    │
└───────────┴──────────────┴─────────────┴─────────────────┴──────────────────────┘
Type Codes

0x009 — Colloquy
0x00A — Agent Session
0x005 — Turn
0x825 — Heartbeat

Embedded Telemetry (42 bits) — spawn_depth (4 bits), signal confidence (16 bits), cache-status flags.
Repository Structure
textcolloquy/
├── herdr-plugin.toml             # Herdr Plugin Manifest (v0.7.0+ compliant)
├── package.json                  # Node dependencies (@libsql/client, etc.)
├── SKILL.md                      # Core Skill Definition & Codebook Spec
├── bin/
│   ├── colloquy-daemon.mjs       # Background daemon listening to Herdr socket API
│   ├── mint.mjs                  # CLI: Mint new session (0x009)
│   ├── heartbeat.mjs             # CLI: Emit semantic decision node (0x825)
│   ├── fork.mjs                  # CLI: Fork colloquy at decision node
│   └── lcars-tui.mjs             # Star Trek LCARS Mission Control TUI
├── lib/
│   ├── derive.mjs                # GYST bit-packing & UUID derivation routines
│   └── database.mjs              # Turso / SQLite connection wrapper
├── schema/
│   └── colloquy-tables.sql       # SQL Schema, indexes, & triggers
└── references/                   # Deep dives on DAG queries, lifecycles, & taxonomies
License
MIT © SoMaCo SF
textCopy-paste the block above into `README.md` (or I can push a PR-ready patch if you connect the repo).

---

## In-Depth Evaluation of the Colloquy Skill

### Concept Strength: Excellent (9/10)

The core idea is genuinely novel and well-motivated:

- Treat multi-turn agent conversations as **first-class, typed, self-addressing DAGs** instead of opaque chat logs.
- Bit-pack topology + telemetry into the UUID itself (GYST) so many queries become pure bit operations or single-row lookups.
- Dual storage (Turso for metadata / Obsidian for content) is pragmatic and failure-tolerant.
- Explicit **counterfactual forking** from any heartbeat is a high-leverage research / debugging primitive that almost no existing agent framework offers.

The 5-minute Anthropic cache window tracking + claimed 6.35× savings is a concrete, measurable win for long pairing sessions.

### Technical Design: Strong but Incomplete (7.5/10)

**What’s solid**
- Clear type codes (`0x009/00A/005/825/823`).
- Deterministic derivation of per-party session UUIDs (no central registry race).
- Heartbeat taxonomy is thoughtful (tool_call, plan_branch, retraction, confidence_shift, etc.).
- Telemetry modes (`minimal` → `audit`) give a good cost/control trade-off.
- `spawn_depth` + epistemic discount formula is a clean governance primitive.

**Gaps / risks**
1. **Collision analysis** is referenced (`references/derivation.md`) but not present in the public repo snapshot. 42-bit random payload + 52-bit timestamp is plenty for practical use, but formal birthday-bound numbers should be published.
2. **Implementation surface is thin** — `package.json` only depends on `@libsql/client`. The daemon, LCARS TUI, mint/fork/heartbeat CLIs are declared but the actual source quality/coverage is unknown from the public tree.
3. **Herdr coupling** is both a strength and a risk. Herdr is real and growing (Rust agent multiplexer with socket API), but the skill also claims to work as a standalone. The boundary between “Herdr plugin” and “pure skill” needs sharper documentation.
4. **Obsidian vault layout** is elegant for humans; the automatic Mermaid decision-tree injection is a nice touch. Persistence guarantees under concurrent writers are not specified.
5. **Schema completeness** — the summary in `SKILL.md` is good; the full `colloquy-tables.sql` + triggers should be the single source of truth and versioned.

### Skill Ergonomics: Good Intent, Needs Polish (7/10)

- Three invocation modes (implicit / inherited / explicit) are well thought out.
- Front-matter `colloquy: true` + telemetry config is the right interface for other skills.
- Auto-promote at turn 2 is user-friendly.
- LCARS theme is pure flavor and will either delight or alienate; keep it optional.

Missing pieces for real adoption:
- Clear “how does an agent *emit* a heartbeat mid-turn?” contract.
- Error / partial-failure semantics (what happens if Turso is down but the vault write succeeds?).
- Query examples (the “why did the agent retract X?” recursive CTE is mentioned but not shown).
- Benchmark numbers for the 6.35× claim under realistic prefix sizes.

### Documentation Quality: Mixed (6/10)

- `SKILL.md` itself is dense, well-structured, and high-signal — one of the better skill definitions I’ve seen.
- README was unusable until reformatted (the main problem you asked about).
- References directory is promised but many of the deep-dive files appear missing or incomplete in the current tree.
- No architecture diagram beyond the ASCII one, no sequence diagrams for mint → turn → heartbeat → fork, no example colloquy dump.

### Overall Assessment

**Colloquy is a high-potential research-grade skill** that sits at the intersection of:

- agent observability,
- causal / counterfactual reasoning,
- cost-aware caching,
- and terminal-native multi-agent orchestration (via Herdr).

It is currently stronger as a **specification and conceptual framework** than as a battle-tested, fully-implemented product. The GYST bit-packing + heartbeat DAG + fork model is the real innovation; the LCARS UI and cache-window tracking are excellent supporting features.
