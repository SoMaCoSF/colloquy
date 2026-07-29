<!-- =============================================================================== file_id: SOM-DOC-5524-v1.0.0 name: SKILL.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

<!-- =============================================================================== file_id: SOM-DOC-5524-v1.0.0 name: SKILL.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

---
file_id: SOM-SKL-0001-v0.1.0
name: colloquy
description: Use when a conversation will span 2+ turns with an agent — turns
  a chat session into a first-class typed, self-addressing, DAG-shaped,
  replayable, forkable, auditable artifact. Mints a 0x009 COLLOQUY UUID,
  derives 0x00A AGENT_SESSION UUIDs for each party, records every turn as
  0x005 TURN, and emits 0x825 HEARTBEAT events at semantic decision points
  (tool calls, model routes, confidence shifts, plan branches, retractions).
  Default for any multi-turn skill (brainstorming, pair-debug, phd-training,
  design-consult). Content → Obsidian vault; metadata + heartbeats → Turso.
  Cache-warm (6.35× cheaper over 20 turns via Anthropic ephemeral prefix).
category: SKL
tags: [colloquy, session, heartbeat, telemetry, dag, gyst, uuidv8, cache, turso, obsidian]
created: 2026-04-21
modified: 2026-04-22
version: 0.1.0
agent_id: claude-sonnet-4-5
mints: [0x009, 0x00A, 0x005, 0x823, 0x825]
---

# Colloquy — Sustained Sessions as First-Class Typed DAGs

## What This Skill Does

Turns a multi-turn conversation into a queryable, walkable, forkable artifact.

Every declared colloquy produces:

- **One `0x009 COLLOQUY` UUID** — the session itself, shared Schelling point
- **One `0x00A AGENT_SESSION` UUID per party** — derived deterministically from
  `(agent_uuid, colloquy_uuid)`. Each party can recompute their own and any
  peer's session UUID with zero DB access.
- **One `0x005 TURN` UUID per turn** — with input/output/cache token metrics
- **N `0x825 HEARTBEAT` UUIDs** — one per semantic decision or action, forming
  a walkable DAG with `parent_heartbeat_uuid` linkage.
- **M `0x823 SCRATCH_OBJECT` UUIDs** — ephemeral KV tied to the colloquy,
  auto-GC'd after idle timeout.
- **One Obsidian vault `.md` file** — canonical transcript with Ghost Catalog
  header, per-turn block anchors, and embedded Mermaid decision tree.

Turso owns metadata. Obsidian owns content. Neither is a single point of
failure — the colloquy survives either one dying.

## When To Invoke

**Always** for multi-turn work. The runtime will auto-promote implicit chats
to colloquies at turn 2, but skills that know they'll sustain should declare
up front via `colloquy: true` in their frontmatter.

Good invocation contexts:
- Brainstorming a feature over 8 turns
- Pair-debugging with an agent over 15 turns
- Design consultation with Vertex
- Multi-step forecast (Dexter loop)
- Teaching / training sessions
- Plan execution via subagent-driven-development

Skip for: one-off pings, help-queries, single-turn commands.

## The Three Invocation Modes

```
┌─────────────┬─────────────────────┬──────────────────────────────────────┐
│  IMPLICIT   │  Auto-promote at    │  Default. Zero friction. If you      │
│             │  turn 2 of an       │  chat with vcmd for 2+ turns within  │
│             │  unthreaded chat.   │  30min, it becomes a colloquy.       │
├─────────────┼─────────────────────┼──────────────────────────────────────┤
│ INHERITED   │  Continue existing  │  vcmd chat --colloquy <uuid> "..."   │
│             │  colloquy by UUID.  │  Appends to prior session's DAG.     │
├─────────────┼─────────────────────┼──────────────────────────────────────┤
│  EXPLICIT   │  Mint at turn 1,    │  vcmd chat --new-colloquy <skill>    │
│ (preferred) │  before any         │  "..." — skills declaring            │
│             │  message exchange.  │  colloquy:true should use this.      │
└─────────────┴─────────────────────┴──────────────────────────────────────┘
```

## Derivation (Why Self-Addressing Matters)

Every party computes identical UUIDs from shared inputs — no registry, no
central minter, no race condition.

```ts
// Colloquy UUID — minted by initiator, adopted by all parties
colloquy_uuid = encodeGYST({
  type: 0x009, namespace: fnv1a12(initiator_agent_uuid),
  timestamp: now_seconds_since_epoch,
  version: 0x8, depth: 0x0, domain: initiator.domain,
  generation: 0x0, variant: 0b10,
  provenance: initiator.provenance,         // 0x1 HUMAN | 0x2 AGENT
  signal: 0xFFFF,                           // deterministic mint
  random: sha256(initiator|timestamp|nonce).slice(42_bits),
});

// Per-party session UUID — each party derives their own
agent_session_uuid = encodeGYST({
  type: 0x00A, namespace: fnv1a12(agent_uuid),
  timestamp: colloquy.timestamp,            // same instant
  version: 0x8, depth: 0x1,                 // child of colloquy
  domain: agent.domain, generation: scheme_version,
  variant: 0b10, provenance: 0x2, signal: 0xFFFF,
  random: sha256(colloquy_uuid|agent_uuid).slice(42_bits),
});

// Heartbeat UUID — minted at each decision/action
heartbeat_uuid = encodeGYST({
  type: 0x825, namespace: fnv1a12(turn_uuid),
  timestamp: emitted_at,
  version: 0x8,
  depth: branch_depth_in_decision_tree,     // tree coordinate!
  domain: 0x6, generation: fork_index,      // tree coordinate!
  variant: 0b10, provenance: AGENT_or_HUMAN,
  signal: confidence_at_this_moment,        // live epistemic state
  random: 42_bits_of_slack,
});
```

See `references/derivation.md` for the full spec and collision analysis.

## Heartbeat Kinds (The Decision Vocabulary)

Heartbeats are emitted at semantic decision points, not arbitrary intervals.

```
tool_call          — Before any tool invocation
skill_invoke       — Skill tool fires
model_route        — Router switches model (haiku→sonnet)
plan_branch        — Multi-option decision point
confidence_shift   — Signal delta ≥ 0.2 between heartbeats
memory_write       — Persistence action
delegation         — Subagent spawned
assertion          — Claim promoted to high confidence
retraction         — Previously held belief abandoned
uuid_mint          — New GYST UUID created
keepalive          — Fallback if no event in N ms / N tokens
```

Each carries `signal` (live confidence 0x0000-0xFFFF), `provenance`, and a
kind-specific `payload_json`. Full taxonomy: `references/heartbeat-taxonomy.md`.

## Telemetry Modes

| Mode | Rows/10-turn | Use case |
|------|:---:|---|
| `minimal` | ~1 | Auto-promoted trivial chats |
| `per_turn` | ~10 | Default for declared skills |
| **`heartbeat`** | ~30-80 | **Recommended for agent loops** |
| `audit` | ~200+ | Compliance, cost debugging |

Set in SKILL.md frontmatter:

```yaml
telemetry:
  mode: heartbeat
  heartbeat_kinds: [tool_call, skill_invoke, model_route, confidence_shift, memory_write]
  keepalive_ms: 30000
  keepalive_tokens: 2000
  signal_shift_threshold: 0.2
```

Override per-invocation via `vcmd chat --telemetry=audit "..."`.

Full spec: `references/telemetry-modes.md`.

## Decision Tree — The Killer Property

Heartbeats carry `parent_heartbeat_uuid`. The sequence becomes a DAG you can
walk, fork, and replay.

```
colloquy root (0x009)
  └─ turn 1
     └─ skill_invoke: brainstorming
        ├─ plan_branch: A/B/C
        │  ├─ tool_call: Read (explored A)
        │  └─ retraction: "A won't scale"   ← dead branch preserved
        ├─ plan_branch: chose_B
        │  ├─ tool_call: Grep
        │  ├─ confidence_shift: 0.4→0.8
        │  ├─ model_route: haiku→sonnet
        │  └─ assertion: "solution viable"
        └─ uuid_mint: 0x322_AERO_FORECAST
```

**What this unlocks:**

- **Replay** — linear walk via `ORDER BY sequence_in_turn`
- **Explain "why?"** — recursive CTE from any heartbeat back to root
- **Counterfactual fork** — `vcmd colloquy fork <heartbeat_uuid>` spawns a
  child colloquy rooted at that decision point with alternate context
- **Dead-branch audit** — `WHERE event_kind='retraction'` is the corpus of
  "things agents almost did wrong" — fine-tuning gold
- **Pattern mining** — graph isomorphism on event_kind sequences detects
  recurring decision archetypes across colloquies
- **Live visualization** — Mermaid diagram rendered into the vault .md,
  LCARS node-link viewer at `/vertex/colloquy/[uuid]/tree`

Full spec: `references/decision-tree.md`.

## Lifecycle

| Moment | Action |
|---|---|
| **Mint** | Colloquy + agent_sessions + vault .md created. Skill heartbeat emitted. |
| **Turn N** | Turn row + heartbeats appended. Cache stays warm. Vault block written with anchor. |
| **Scratch op** | KV scoped to colloquy_uuid. Written to `scratch_objects`. |
| **Idle (30-60 min, skill-configured)** | Auto-close. `ended_at` set. Scratch GC'd after grace. |
| **Explicit `/close`** | Immediate termination. Optional `/promote` folds key heartbeats into long-term memory as `0x006 FACT` UUIDs with `0x822 MEMORY_MUTATION` audit. |

Full spec: `references/lifecycle.md`.

## Vault Layout

```
~/vertex-vault/colloquies/
  2026-04-22-phd-training-7fa3b2c1.md     ← one file per colloquy
    ---
    file_id: SOM-DOC-0044-v0.1.0
    colloquy_uuid: 7fa3…b2c1
    parties:
      - agent: vertex (0x501…)
      - agent: claude-sonnet-4-5 (0x503…)
      - human: somaco (0x002…)
    skill: phd-training
    started_at: 2026-04-22T14:22:00Z
    telemetry_mode: heartbeat
    ---

    ## Turn 1 — Prime Directive
    **Speaker:** claude-sonnet-4-5 (trainer)
    **Tokens:** in=615 out=392 cache_r=6145 cache_w=0
    **Heartbeats:** 3 (skill_invoke, tool_call×2)

    > TURN 1/7 — PRIME DIRECTIVE...

    ^turn-001

    ## Decision Tree

    ```mermaid
    graph TD
      R[root] --> T1[turn 1]
      ...
    ```
```

## Turso Schema (Authoritative Summary)

```sql
CREATE TABLE colloquies (
  colloquy_uuid TEXT PRIMARY KEY,       -- 0x009
  rowid INTEGER UNIQUE,                 -- internal FK optimization
  skill_name TEXT,
  invocation_mode TEXT,                 -- 'implicit'|'inherited'|'explicit'
  initiator_uuid TEXT NOT NULL,
  started_at INTEGER, ended_at INTEGER,
  cache_warm_until INTEGER,
  prefix_tokens INTEGER,
  turn_count INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cache_read INTEGER DEFAULT 0,
  total_cache_write INTEGER DEFAULT 0,
  total_cost_usd_micro INTEGER DEFAULT 0,
  cache_hit_ratio REAL,
  telemetry_mode TEXT DEFAULT 'per_turn',
  auto_close_idle_s INTEGER DEFAULT 1800,
  vault_path TEXT
);

CREATE TABLE agents (
  agent_uuid TEXT PRIMARY KEY,          -- 0x002 USER | 0x003 AGENT
  name TEXT, model TEXT, born_at INTEGER
);

CREATE TABLE agent_sessions (
  session_uuid TEXT PRIMARY KEY,        -- 0x00A, derived deterministically
  agent_uuid TEXT NOT NULL,
  colloquy_uuid TEXT NOT NULL,
  role TEXT,                            -- 'trainer'|'trainee'|'peer'|'human'
  joined_at INTEGER,
  UNIQUE(agent_uuid, colloquy_uuid)
);

CREATE TABLE turns (
  turn_uuid TEXT PRIMARY KEY,           -- 0x005
  colloquy_uuid TEXT NOT NULL,
  turn_index INTEGER,
  speaker_session_uuid TEXT,
  started_at INTEGER, completed_at INTEGER,
  model TEXT,
  input_tokens INTEGER, output_tokens INTEGER,
  cache_read_tokens INTEGER, cache_write_tokens INTEGER,
  cost_usd_micro INTEGER, latency_ms INTEGER,
  vault_anchor TEXT
);

CREATE TABLE heartbeats (
  heartbeat_uuid TEXT PRIMARY KEY,      -- 0x825
  turn_uuid TEXT NOT NULL,
  colloquy_uuid TEXT NOT NULL,
  parent_heartbeat_uuid TEXT,           -- DAG edge
  emitted_at INTEGER,
  sequence_in_turn INTEGER,
  branch_depth INTEGER DEFAULT 0,
  event_kind TEXT NOT NULL,
  event_label TEXT,
  tokens_accumulated INTEGER,
  cache_state TEXT,
  signal INTEGER,                       -- 0x0000-0xFFFF confidence
  provenance INTEGER,
  payload_json TEXT
);

CREATE TABLE scratch_objects (
  uuid TEXT PRIMARY KEY,                -- 0x823
  colloquy_uuid TEXT NOT NULL,
  key TEXT NOT NULL, value TEXT,
  expires_at INTEGER,
  UNIQUE(colloquy_uuid, key)
);
```

Full migrations: `schema/colloquy-tables.sql`.

## CLI — vcmd Extensions

```bash
# Mint explicit colloquy
vcmd colloquy mint --skill <name> --parties <a,b,c> [--telemetry <mode>]

# Chat in explicit colloquy
vcmd chat --new-colloquy <skill> "first turn..."

# Chat in existing colloquy
vcmd chat --colloquy <uuid> "continuing..."

# Walk decision tree
vcmd colloquy walk <colloquy_uuid> [--format text|mermaid|json]

# Fork at a heartbeat
vcmd colloquy fork <heartbeat_uuid> --skill <name>

# Emit semantic heartbeat (for explicit instrumentation)
vcmd heartbeat <colloquy_uuid> <kind> <label> [--signal 0xXXXX] [--payload '{...}']

# Scratch KV
vcmd scratch set <colloquy_uuid> <key> <value>
vcmd scratch get <colloquy_uuid> <key>

# Close (optional promote)
vcmd colloquy close <colloquy_uuid> [--promote]
```

Scripts: `scripts/mint.mjs`, `scripts/heartbeat.mjs`, `scripts/walk.mjs`,
`scripts/fork.mjs`, `scripts/render-mermaid.mjs`.

## Daemon Endpoints (openclaw)

```
POST /v1/colloquy/mint       { skill, parties, telemetry_mode? }  → { colloquy_uuid, session_uuids }
POST /v1/colloquy/:uuid/turn { speaker_uuid, model, tokens, content } → { turn_uuid }
POST /v1/heartbeat           { colloquy_uuid, turn_uuid, parent?, kind, label, signal?, payload? } → { heartbeat_uuid }
POST /v1/scratch             { colloquy_uuid, key, value }        → { uuid }
GET  /v1/scratch/:uuid/:key                                       → { value }
GET  /v1/colloquy/:uuid/tree                                      → { nodes, edges }
POST /v1/colloquy/:uuid/fork { from_heartbeat, skill }            → { new_colloquy_uuid }
POST /v1/colloquy/:uuid/close { promote? }                        → { ended_at, fact_uuids? }
```

## The Claim

**Every conversation is a first-class, typed, self-addressing, DAG-shaped,
replayable, forkable, auditable artifact whose bits alone partially decode
its own topology.**

That's not a pitch. It's the literal data model.

## See Also

- `references/derivation.md` — UUID derivation formulas, collision analysis
- `references/lifecycle.md` — state machine, GC, promotion semantics
- `references/heartbeat-taxonomy.md` — full event_kind registry
- `references/telemetry-modes.md` — mode selection guide
- `references/decision-tree.md` — DAG queries, fork semantics, Mermaid spec
- `schema/colloquy-tables.sql` — Turso migrations
- `scripts/` — CLI implementation
- `examples/first-colloquy.md` — retro-mint of the 2026-04-21 PhD training
- Codebook §12-§15 — canonical codebook sections for this skill
