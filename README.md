Colloquy — Causal DAG Audit Logs & Telemetry for Agent SwarmsColloquy turns sustained multi-agent sessions into typed, self-addressing, DAG-shaped, replayable, forkable, and auditable artifacts. Every decision, tool call, model route, and retraction is anchored to bit-packed 128-bit UUIDs (scheme_v=1), encoding telemetry and topology directly into the identifier bits without expensive database joins.Designed as both a standalone agent skill and a native Herdr terminal multiplexer plugin.🔑 Key Features🧬 Self-Addressing Causal DAGs: Every turn and decision point (heartbeat) is assigned a typed 128-bit UUID (0x009 COLLOQUY, 0x00A SESSION, 0x005 TURN, 0x825 HEARTBEAT).⚡ 5-Minute Ephemeral Cache Optimization: Native tracking of Anthropic prompt caching windows (cache_warm_until = completed_at + 300,000ms) yields up to $6.35\times$ token savings during interactive pairing sessions.🔀 Counterfactual Decision Forking: Spawns child colloquies directly from past decision heartbeats (/v1/colloquy/fork) to explore alternate execution branches while retaining full causal history.🛡️ Subagent Governance & Circuit Breakers: Bit-packed spawn_depth tracking enforces physical boundaries (e.g., depth $\le 15$) and applies an epistemic trust discount ($\text{trust} = \text{signal} \times (1 - \epsilon)^d$).🖖 Star Trek LCARS Mission Control Overlay: Built-in 24-bit ANSI LCARS terminal interface for multiplexer overlay panes (somaco.colloquy.lcars).🗄️ Turso / SQLite Edge Sync: Lightweight schema with automated triggers for cache ratio rollups, turn counts, and cost accounting.🛠️ Architecture Overview┌────────────────────────────────────────────────────────────────────────────┐
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
│               │   Herdr Socket API (`HERDR_SOCKET_PATH`)  │                │
│               └─────────────────────┬─────────────────────┘                │
└─────────────────────────────────────┼──────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                           COLLOQUY DAEMON & ENGINE                         │
│                                                                            │
│ • Bit-packs telemetry into GYST 128-bit UUIDs                              │
│ • Maintains rolling 5-minute prompt cache TTL                              │
│ • Writes ACID rows to Turso / SQLite (`colloquy-tables.sql`)              │
│ • Drives LCARS Mission Control Overlay (`somaco.colloquy.lcars`)           │
└────────────────────────────────────────────────────────────────────────────┘
📦 InstallationOption 1: Install via Herdr MarketplaceIf you are using the Herdr terminal multiplexer, install directly from GitHub:Bashherdr plugin install somacosf/colloquy
Option 2: Local Development LinkTo work on Colloquy locally, clone and link the repository into Herdr:Bashgit clone https://github.com/somacosf/colloquy.git
cd colloquy

# Install dependencies
npm install

# Link plugin into running Herdr workspace
herdr plugin link .
🚀 Usage & CommandsCommand Palette & Herdr ActionsColloquy registers the following commands in Herdr’s action runner (Ctrl+P or CLI):Action IDAction TitleContextDescriptionsomaco.colloquy.mintColloquy: Mint Session (0x009)Workspace / PaneMints a new 0x009 Colloquy UUID and derived party sessions.somaco.colloquy.forkColloquy: Counterfactual ForkPaneForks the active session at a specific decision node into a child DAG.somaco.colloquy.view-lcarsColloquy: Toggle LCARS DashboardWorkspaceToggles the 24-bit Star Trek LCARS overlay dashboard.Invoke actions from the command line:Bash# Mint a new session
herdr plugin action invoke somaco.colloquy.mint -- --skill "system-refactor" --parties "somaco,vertex"

# Open the LCARS Mission Control Overlay
herdr plugin action invoke somaco.colloquy.view-lcars
CLI Utilities1. Minting a ColloquyBashnode bin/mint.mjs --skill "codebook-audit" --parties "somaco,vertex" --telemetry heartbeat
2. Emitting Decision HeartbeatsBash# Record an explicit semantic decision point (plan_branch, assertion, retraction)
node bin/heartbeat.mjs <colloquy_uuid> plan_branch "optimizing_index_strategy" --signal 0xE666
3. Counterfactual ForkingBash# Fork an existing colloquy at a decision point to explore alternate context
node bin/fork.mjs <heartbeat_uuid> --skill "alternate-plan" --context '{"strategy":"in-memory"}'
4. LCARS Mission Control TUIBash# Non-interactive roster dump
node bin/lcars-tui.mjs --list

# Launch full terminal UI
node bin/lcars-tui.mjs
🗄️ Database Schema & StorageThe state layer operates on Turso / SQLite and is defined in schema/colloquy-tables.sql.agents: Registry of human operators and agent principals.colloquies: Top-level DAG headers (storing telemetry_mode, cache_warm_until, token rollups).agent_sessions: Session UUID derived for each party joining a colloquy.turns: Individual messages / model turns with token usage and cache accounting.heartbeats: Causal DAG nodes representing tool calls, skill invokes, confidence shifts, and retractions.colloquy_forks: Lineage mapping between parent decision heartbeats and child colloquies.🧬 GYST 128-Bit UUID Bit Layout (scheme_v=1)Colloquy utilizes GYST bit-packed identifiers to embed node metadata directly in bit ranges:┌───────────┬──────────────┬─────────────┬─────────────────┬──────────────────────┐
│ Prefix    │ Type Code    │ Domain/Prov │ Timestamp/Nonce │ Embedded Telemetry   │
│ (16 bits) │ (12 bits)    │ (8 bits)    │ (52 bits)       │ Payload (42 bits)    │
└───────────┴──────────────┴─────────────┴─────────────────┴──────────────────────┘
Type Codes: 0x009 (Colloquy), 0x00A (Agent Session), 0x005 (Turn), 0x825 (Heartbeat).Embedded Telemetry (42 bits): Includes spawn_depth (4 bits), signal confidence (16 bits), and cache status flags.📁 Repository Structurecolloquy/
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
└── references/                   # Deep dives on DAG queries, lifecycles, & taxonomie
