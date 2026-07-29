-- =============================================================================
-- file_id: SOM-SCH-0001-v0.1.0
-- name: colloquy-tables.sql
-- description: Turso schema for the colloquy skill — agents, colloquies,
--              agent_sessions, turns, heartbeats, scratch_objects,
--              colloquy_forks, facts, memory_mutations. Plus indexes,
--              triggers for rollups, and CHECK constraints for
--              deterministic derivation.
-- category: SCH
-- tags: [colloquy, schema, turso, migrations]
-- created: 2026-04-22
-- version: 0.1.0
-- apply with: turso db shell <db> < colloquy-tables.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. AGENTS — registry of all principals (humans + agents) that can party
--            up in a colloquy.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agents (
  agent_uuid TEXT PRIMARY KEY,           -- 0x002 USER or 0x003 AGENT
  name TEXT NOT NULL,                    -- 'somaco', 'vertex', 'claude-sonnet-4-5'
  kind TEXT NOT NULL,                    -- 'human' | 'agent'
  model TEXT,                            -- null for humans; 'claude-sonnet-4-5' etc for agents
  provenance INTEGER NOT NULL,           -- 0x1 HUMAN | 0x2 AGENT (matches UUID field)
  domain INTEGER NOT NULL,               -- matches UUID domain field
  born_at INTEGER NOT NULL,              -- ms since epoch
  metadata_json TEXT                     -- persona/capabilities freeform
);

CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
CREATE INDEX IF NOT EXISTS idx_agents_kind ON agents(kind);

-- ---------------------------------------------------------------------------
-- 2. COLLOQUIES — session itself, shared Schelling point.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS colloquies (
  colloquy_uuid TEXT PRIMARY KEY,        -- 0x009 COLLOQUY, canonical external ID
  skill_name TEXT,                       -- 'phd-training' | 'brainstorming' | null
  invocation_mode TEXT NOT NULL
    CHECK (invocation_mode IN ('implicit', 'inherited', 'explicit')),
  initiator_uuid TEXT NOT NULL,          -- FK agents(agent_uuid)
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  last_turn_at INTEGER,                  -- drives idle timeout
  close_reason TEXT,                     -- 'explicit' | 'idle_timeout' | 'abandoned_sweep' | 'crash'
  cache_warm_until INTEGER,              -- started_at + 5*60*1000 rolling
  prefix_tokens INTEGER DEFAULT 0,
  turn_count INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cache_read INTEGER DEFAULT 0,
  total_cache_write INTEGER DEFAULT 0,
  total_cost_usd_micro INTEGER DEFAULT 0,  -- micro-USD to avoid floats
  cache_hit_ratio REAL,
  telemetry_mode TEXT NOT NULL DEFAULT 'per_turn'
    CHECK (telemetry_mode IN ('minimal', 'per_turn', 'heartbeat', 'audit')),
  telemetry_config_json TEXT,            -- heartbeat_kinds, keepalive_ms, etc
  auto_close_idle_s INTEGER NOT NULL DEFAULT 1800,
  scratch_grace_s INTEGER NOT NULL DEFAULT 600,
  vault_path TEXT,                       -- e.g. 'colloquies/2026-04-22-phd-training-7fa3b2c1.md'
  parent_colloquy_uuid TEXT,             -- set if this is a fork
  forked_at_heartbeat_uuid TEXT,         -- where the fork happened
  nonce TEXT                             -- for derivation reproducibility
);

CREATE INDEX IF NOT EXISTS idx_colloquies_skill ON colloquies(skill_name);
CREATE INDEX IF NOT EXISTS idx_colloquies_initiator ON colloquies(initiator_uuid);
CREATE INDEX IF NOT EXISTS idx_colloquies_active ON colloquies(ended_at)
  WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_colloquies_parent ON colloquies(parent_colloquy_uuid)
  WHERE parent_colloquy_uuid IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. AGENT_SESSIONS — per-party projection of a colloquy.
--                     session_uuid is DERIVED from (agent_uuid, colloquy_uuid).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_sessions (
  session_uuid TEXT PRIMARY KEY,         -- 0x00A AGENT_SESSION, deterministic
  agent_uuid TEXT NOT NULL,              -- FK agents
  colloquy_uuid TEXT NOT NULL,           -- FK colloquies
  role TEXT,                             -- 'initiator' | 'trainer' | 'trainee' | 'peer' | 'human'
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  UNIQUE (agent_uuid, colloquy_uuid),    -- one session per agent per colloquy
  FOREIGN KEY (agent_uuid) REFERENCES agents(agent_uuid),
  FOREIGN KEY (colloquy_uuid) REFERENCES colloquies(colloquy_uuid)
);

CREATE INDEX IF NOT EXISTS idx_sessions_by_colloquy ON agent_sessions(colloquy_uuid);
CREATE INDEX IF NOT EXISTS idx_sessions_by_agent ON agent_sessions(agent_uuid);

-- ---------------------------------------------------------------------------
-- 4. TURNS — one row per message exchanged.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS turns (
  turn_uuid TEXT PRIMARY KEY,            -- 0x005 TURN
  colloquy_uuid TEXT NOT NULL,
  turn_index INTEGER NOT NULL,           -- 1, 2, 3...
  speaker_session_uuid TEXT NOT NULL,    -- FK agent_sessions
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  model TEXT,                            -- 'claude-sonnet-4-5', 'claude-haiku-4-5', etc
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  cost_usd_micro INTEGER,                -- derived from model+tokens, 6-decimal USD
  latency_ms INTEGER,
  status TEXT DEFAULT 'completed'
    CHECK (status IN ('in_flight', 'completed', 'interrupted', 'error')),
  error_message TEXT,
  vault_anchor TEXT,                     -- 'colloquies/2026-04-22-...md#^turn-007'
  heartbeat_count INTEGER DEFAULT 0,
  FOREIGN KEY (colloquy_uuid) REFERENCES colloquies(colloquy_uuid),
  UNIQUE (colloquy_uuid, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_turns_by_colloquy ON turns(colloquy_uuid, turn_index);
CREATE INDEX IF NOT EXISTS idx_turns_by_speaker ON turns(speaker_session_uuid);
CREATE INDEX IF NOT EXISTS idx_turns_in_flight ON turns(status)
  WHERE status = 'in_flight';

-- ---------------------------------------------------------------------------
-- 5. HEARTBEATS — the decision-tree DAG.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS heartbeats (
  heartbeat_uuid TEXT PRIMARY KEY,       -- 0x825 HEARTBEAT
  turn_uuid TEXT NOT NULL,               -- FK turns
  colloquy_uuid TEXT NOT NULL,           -- denormalized for query speed
  parent_heartbeat_uuid TEXT,            -- DAG edge; NULL = root of turn
  emitted_at INTEGER NOT NULL,
  sequence_in_turn INTEGER NOT NULL,     -- 1, 2, 3... within turn
  branch_depth INTEGER NOT NULL DEFAULT 0,
  event_kind TEXT NOT NULL
    CHECK (event_kind IN (
      'tool_call', 'skill_invoke', 'model_route', 'plan_branch',
      'confidence_shift', 'memory_write', 'delegation',
      'assertion', 'retraction', 'uuid_mint', 'keepalive'
    )),
  event_label TEXT,                      -- freeform: 'chose_Read_over_Grep'
  tokens_accumulated INTEGER,            -- snapshot at emit (row-level truth)
  cache_hit_ratio_snapshot REAL,         -- scheme_v=1: live cache-savings ratio.
                                         -- Also lossily packed into last 42 bits of
                                         -- heartbeat_uuid when generation=0x1.
  scheme_v INTEGER NOT NULL DEFAULT 1    -- 0 = random(42) entropy only,
    CHECK (scheme_v IN (0, 1)),          -- 1 = tokens_q(16)|savings_q(10)|rand(16)
  cache_state TEXT
    CHECK (cache_state IS NULL OR cache_state IN ('cold', 'warm', 'expired')),
  signal INTEGER                         -- 0x0000-0xFFFF, live confidence
    CHECK (signal IS NULL OR (signal >= 0 AND signal <= 65535)),
  provenance INTEGER NOT NULL
    CHECK (provenance IN (0, 1, 2, 3, 4, 5, 6, 7, 8, 15)),  -- 0x0-0x8, 0xF
  payload_json TEXT,
  FOREIGN KEY (turn_uuid) REFERENCES turns(turn_uuid),
  FOREIGN KEY (colloquy_uuid) REFERENCES colloquies(colloquy_uuid),
  UNIQUE (turn_uuid, sequence_in_turn)
);

CREATE INDEX IF NOT EXISTS idx_heartbeat_tree ON heartbeats(colloquy_uuid, parent_heartbeat_uuid);
CREATE INDEX IF NOT EXISTS idx_heartbeat_kind ON heartbeats(colloquy_uuid, event_kind, emitted_at);
CREATE INDEX IF NOT EXISTS idx_heartbeat_turn_seq ON heartbeats(turn_uuid, sequence_in_turn);
CREATE INDEX IF NOT EXISTS idx_heartbeat_retraction ON heartbeats(event_kind, emitted_at)
  WHERE event_kind = 'retraction';

-- ---------------------------------------------------------------------------
-- 6. SCRATCH_OBJECTS — ephemeral KV per colloquy.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scratch_objects (
  uuid TEXT PRIMARY KEY,                 -- 0x823 SCRATCH_OBJECT
  colloquy_uuid TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,                            -- opaque blob, typically JSON
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,                    -- NULL = no expiry (rare)
  persist_on_close INTEGER DEFAULT 0,    -- 1 if key starts with @persist/
  UNIQUE (colloquy_uuid, key),
  FOREIGN KEY (colloquy_uuid) REFERENCES colloquies(colloquy_uuid)
);

CREATE INDEX IF NOT EXISTS idx_scratch_by_colloquy ON scratch_objects(colloquy_uuid);
CREATE INDEX IF NOT EXISTS idx_scratch_expired ON scratch_objects(expires_at)
  WHERE expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. COLLOQUY_FORKS — counterfactual lineage.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS colloquy_forks (
  fork_uuid TEXT PRIMARY KEY,
  parent_colloquy_uuid TEXT NOT NULL,
  child_colloquy_uuid TEXT NOT NULL UNIQUE,
  forked_at_heartbeat_uuid TEXT NOT NULL,  -- where the fork happened
  forked_at INTEGER NOT NULL,
  reason TEXT,                            -- freeform: 'try option B instead'
  context_override_json TEXT,
  FOREIGN KEY (parent_colloquy_uuid) REFERENCES colloquies(colloquy_uuid),
  FOREIGN KEY (child_colloquy_uuid) REFERENCES colloquies(colloquy_uuid),
  FOREIGN KEY (forked_at_heartbeat_uuid) REFERENCES heartbeats(heartbeat_uuid)
);

CREATE INDEX IF NOT EXISTS idx_forks_by_parent ON colloquy_forks(parent_colloquy_uuid);
CREATE INDEX IF NOT EXISTS idx_forks_by_heartbeat ON colloquy_forks(forked_at_heartbeat_uuid);

-- ---------------------------------------------------------------------------
-- 8. FACTS — long-term memory, minted during PROMOTING state.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS facts (
  fact_uuid TEXT PRIMARY KEY,            -- 0x006 FACT
  content TEXT NOT NULL,
  source_heartbeat_uuid TEXT,            -- what decision produced this fact
  source_colloquy_uuid TEXT,
  created_at INTEGER NOT NULL,
  signal INTEGER NOT NULL,               -- confidence at mint
  provenance INTEGER NOT NULL,
  tags_json TEXT,
  vault_path TEXT,                       -- where in vault this lives
  FOREIGN KEY (source_heartbeat_uuid) REFERENCES heartbeats(heartbeat_uuid),
  FOREIGN KEY (source_colloquy_uuid) REFERENCES colloquies(colloquy_uuid)
);

CREATE INDEX IF NOT EXISTS idx_facts_by_colloquy ON facts(source_colloquy_uuid);
CREATE INDEX IF NOT EXISTS idx_facts_by_signal ON facts(signal);

-- ---------------------------------------------------------------------------
-- 9. MEMORY_MUTATIONS — audit trail of any change to persistent memory.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS memory_mutations (
  mutation_uuid TEXT PRIMARY KEY,        -- 0x822 MEMORY_MUTATION
  mutation_kind TEXT NOT NULL
    CHECK (mutation_kind IN ('promote', 'insert', 'update', 'retract', 'rollback')),
  target_type TEXT NOT NULL,             -- 'fact' | 'codebook_section' | 'vault_file'
  target_uuid TEXT,                      -- what was changed
  source_colloquy_uuid TEXT,             -- which colloquy produced this
  source_heartbeat_uuid TEXT,            -- which decision
  prior_content_hash TEXT,               -- sha256 of content before change
  new_content_hash TEXT,                 -- sha256 after
  mutated_at INTEGER NOT NULL,
  mutated_by_agent_uuid TEXT,
  approved_by_human INTEGER DEFAULT 0,   -- 1 if human approved via UI
  approval_session_uuid TEXT             -- which agent_session approved
);

CREATE INDEX IF NOT EXISTS idx_mutations_target ON memory_mutations(target_uuid);
CREATE INDEX IF NOT EXISTS idx_mutations_colloquy ON memory_mutations(source_colloquy_uuid);

-- ---------------------------------------------------------------------------
-- 10. TRIGGERS — auto-update colloquy rollups on turn / heartbeat inserts.
-- ---------------------------------------------------------------------------

-- Turn complete → update colloquy aggregates
CREATE TRIGGER IF NOT EXISTS trg_turn_completed
AFTER UPDATE OF completed_at ON turns
WHEN NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL
BEGIN
  UPDATE colloquies
  SET turn_count = turn_count + 1,
      total_input_tokens = total_input_tokens + COALESCE(NEW.input_tokens, 0),
      total_output_tokens = total_output_tokens + COALESCE(NEW.output_tokens, 0),
      total_cache_read = total_cache_read + COALESCE(NEW.cache_read_tokens, 0),
      total_cache_write = total_cache_write + COALESCE(NEW.cache_write_tokens, 0),
      total_cost_usd_micro = total_cost_usd_micro + COALESCE(NEW.cost_usd_micro, 0),
      cache_hit_ratio = CAST(total_cache_read + COALESCE(NEW.cache_read_tokens, 0) AS REAL)
        / NULLIF(total_input_tokens + COALESCE(NEW.input_tokens, 0), 0),
      last_turn_at = NEW.completed_at,
      cache_warm_until = NEW.completed_at + 300000  -- +5 min rolling
  WHERE colloquy_uuid = NEW.colloquy_uuid;
END;

-- Heartbeat insert → increment turn heartbeat count
CREATE TRIGGER IF NOT EXISTS trg_heartbeat_count
AFTER INSERT ON heartbeats
BEGIN
  UPDATE turns SET heartbeat_count = heartbeat_count + 1
  WHERE turn_uuid = NEW.turn_uuid;
END;

-- ---------------------------------------------------------------------------
-- 11. SEED — canonical agents & type registry entries.
-- ---------------------------------------------------------------------------

-- Somaco (human operator) — 0x002 USER
-- Agent UUID should be pre-minted deterministically; placeholder here.
-- Real mint happens in scripts/seed-agents.mjs.

-- Type registry entries (informational; not enforced here):
-- 0x005 TURN
-- 0x006 FACT
-- 0x009 COLLOQUY
-- 0x00A AGENT_SESSION
-- 0x823 SCRATCH_OBJECT
-- 0x822 MEMORY_MUTATION
-- 0x825 HEARTBEAT

-- =============================================================================
-- END colloquy-tables.sql
-- =============================================================================
