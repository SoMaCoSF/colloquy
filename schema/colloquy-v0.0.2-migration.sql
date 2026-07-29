-- =============================================================================
-- file_id: SOM-SCH-0002-v0.0.2
-- name: colloquy-v0.0.2-migration.sql
-- description: v0.0.2 migration — witness-as-parent, spawn_depth, agent birth
--              ritual, codebook pinning. Applies on top of colloquy-tables.sql
--              (v0.0.1). Idempotent where SQLite ALTER permits.
-- category: SCH
-- tags: [colloquy, schema, migration, v0.0.2, witness, spawn-depth, agent-birth]
-- created: 2026-04-22
-- version: 0.0.2
-- apply with: turso db shell <db> < colloquy-v0.0.2-migration.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. AGENTS — promote to birth-registry. Adds lineage, codebook pin,
--             directive, witness policy, birth-heartbeat audit anchor.
-- ---------------------------------------------------------------------------

ALTER TABLE agents ADD COLUMN parent_agent_uuid TEXT;
ALTER TABLE agents ADD COLUMN spawn_depth INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN codebook_version_at_birth TEXT;
ALTER TABLE agents ADD COLUMN directive_json TEXT;
ALTER TABLE agents ADD COLUMN birth_heartbeat_uuid TEXT;
ALTER TABLE agents ADD COLUMN birth_colloquy_uuid TEXT;
ALTER TABLE agents ADD COLUMN witness_policy TEXT
  CHECK (witness_policy IS NULL OR witness_policy IN
    ('parent_required', 'self_signed_ok', 'human_escalate'));
ALTER TABLE agents ADD COLUMN ended_at INTEGER;       -- set when agent terminates
ALTER TABLE agents ADD COLUMN end_reason TEXT;        -- 'task_complete' | 'parent_revoke' | 'colloquy_close' | 'crash'

-- Codebook projection fields (v0.0.2 icosphere unification).
-- At birth, the agent's pinned codebook is projected onto the icosphere
-- via projectUUID() from app/api/lib/icosphere.ts. The resulting face,
-- radial band, and (theta, phi) coordinates are recorded here so that
-- spatial queries (nearest-codebook, drift-vector, divergence-monitor)
-- do not need to recompute the projection at read time.
ALTER TABLE agents ADD COLUMN codebook_uuid TEXT;            -- 0x00E CODEBOOK_PERSONA UUID
ALTER TABLE agents ADD COLUMN codebook_face_id INTEGER;      -- 0..19 (icosa face)
ALTER TABLE agents ADD COLUMN codebook_shell INTEGER;        -- radial band (depth-derived)
ALTER TABLE agents ADD COLUMN codebook_sector INTEGER;       -- 0..15 (domain-derived)
ALTER TABLE agents ADD COLUMN codebook_theta REAL;           -- polar angle on the face
ALTER TABLE agents ADD COLUMN codebook_phi REAL;             -- azimuthal angle

CREATE INDEX IF NOT EXISTS idx_agents_codebook ON agents(codebook_uuid);
CREATE INDEX IF NOT EXISTS idx_agents_codebook_face ON agents(codebook_face_id, codebook_shell, codebook_sector);

CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_agent_uuid);
CREATE INDEX IF NOT EXISTS idx_agents_by_depth ON agents(spawn_depth);
CREATE INDEX IF NOT EXISTS idx_agents_live ON agents(ended_at) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agents_by_colloquy_birth ON agents(birth_colloquy_uuid);

-- ---------------------------------------------------------------------------
-- 2. AGENT_SESSIONS — spawn lineage within a colloquy.
-- ---------------------------------------------------------------------------

ALTER TABLE agent_sessions ADD COLUMN parent_session_uuid TEXT;
ALTER TABLE agent_sessions ADD COLUMN spawn_depth INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_sessions ADD COLUMN birth_heartbeat_uuid TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_parent ON agent_sessions(parent_session_uuid);
CREATE INDEX IF NOT EXISTS idx_sessions_by_depth ON agent_sessions(spawn_depth);

-- ---------------------------------------------------------------------------
-- 2.5. CODEBOOK_PERSONAS — SME prompt-corpora for agent-birth pinning.
--      Each persona is a 0x00E CODEBOOK_PERSONA UUID. Projected onto the
--      icosphere so that spawn-time retrieval is a spatial query.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS codebook_personas (
  codebook_uuid TEXT PRIMARY KEY,              -- 0x00E CODEBOOK_PERSONA
  name TEXT NOT NULL,                          -- 'persona-scanner', 'persona-dexter', etc
  domain INTEGER NOT NULL,                     -- 0..15 (MoE expert cluster key)
  generation INTEGER NOT NULL DEFAULT 1,       -- version counter within (name, domain)
  content_hash TEXT NOT NULL,                  -- sha256 of the .md file contents
  content_path TEXT NOT NULL,                  -- relative path to codebooks/*.md
  face_id INTEGER NOT NULL,                    -- icosphere face 0..19
  shell INTEGER NOT NULL,
  sector INTEGER NOT NULL,
  theta REAL NOT NULL,
  phi REAL NOT NULL,
  parent_codebook_uuid TEXT,                   -- previous version (evolution tracking)
  created_at INTEGER NOT NULL,
  created_by_agent_uuid TEXT,                  -- writer agent that authored this
  metadata_json TEXT,
  UNIQUE(name, domain, generation)
);

CREATE INDEX IF NOT EXISTS idx_codebooks_name ON codebook_personas(name, generation);
CREATE INDEX IF NOT EXISTS idx_codebooks_domain ON codebook_personas(domain);
CREATE INDEX IF NOT EXISTS idx_codebooks_face ON codebook_personas(face_id, shell, sector);
CREATE INDEX IF NOT EXISTS idx_codebooks_parent ON codebook_personas(parent_codebook_uuid);

-- ---------------------------------------------------------------------------
-- 3. HEARTBEATS — witness chain + scheme_v + live-telemetry snapshot.
--    NOTE: event_kind CHECK constraint cannot be altered in SQLite; we add
--    new kinds via a CHECK replacement migration below. For now, document
--    that writers must validate against the v0.0.2 kind set before INSERT.
-- ---------------------------------------------------------------------------

ALTER TABLE heartbeats ADD COLUMN witnessed_by_session_uuid TEXT;
ALTER TABLE heartbeats ADD COLUMN witnessed_type_code INTEGER;
ALTER TABLE heartbeats ADD COLUMN witnesses_heartbeat_uuid TEXT;  -- what this heartbeat signs off on
ALTER TABLE heartbeats ADD COLUMN codebook_v TEXT;                -- version at emit
ALTER TABLE heartbeats ADD COLUMN cache_hit_ratio_snapshot REAL;  -- scheme_v=1 row truth
ALTER TABLE heartbeats ADD COLUMN scheme_v INTEGER NOT NULL DEFAULT 1
  CHECK (scheme_v IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_hb_witness ON heartbeats(witnessed_by_session_uuid)
  WHERE witnessed_by_session_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hb_signoff_target ON heartbeats(witnesses_heartbeat_uuid)
  WHERE witnesses_heartbeat_uuid IS NOT NULL;

-- Replacement CHECK constraint for event_kind cannot run via ALTER in SQLite;
-- instead we enforce via a trigger that rejects unknown kinds.

DROP TRIGGER IF EXISTS trg_heartbeat_kind_v002;
CREATE TRIGGER trg_heartbeat_kind_v002
BEFORE INSERT ON heartbeats
FOR EACH ROW
WHEN NEW.event_kind NOT IN (
  -- v0.0.1 kinds
  'tool_call', 'skill_invoke', 'model_route', 'plan_branch',
  'confidence_shift', 'memory_write', 'delegation',
  'assertion', 'retraction', 'uuid_mint', 'keepalive',
  -- v0.0.2 additions
  'agent_birth',
  'witness_signoff', 'witness_refusal', 'witness_deferred'
)
BEGIN
  SELECT RAISE(ABORT, 'heartbeat event_kind not in v0.0.2 registry');
END;

-- ---------------------------------------------------------------------------
-- 4. DIRECTIVES — optional reusable mission briefs (0x00C DIRECTIVE UUID).
--    When a directive is novel/ephemeral, it lives inline in agents.directive_json.
--    When reused (e.g., 'aero-forecast-template'), it earns its own UUID here.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS directives (
  directive_uuid TEXT PRIMARY KEY,         -- 0x00C DIRECTIVE
  name TEXT NOT NULL,                      -- 'aero-forecast-pool' etc
  task_type_code INTEGER NOT NULL,         -- expected output type
  scope_json TEXT NOT NULL,                -- tools, max_spawn_depth, budget_tokens
  witness_policy TEXT NOT NULL
    CHECK (witness_policy IN ('parent_required', 'self_signed_ok', 'human_escalate')),
  codebook_version_required TEXT,          -- min codebook version the executor must have
  deadline_s INTEGER,                      -- soft deadline, 0 = none
  created_at INTEGER NOT NULL,
  created_by_agent_uuid TEXT,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_directives_name ON directives(name);
CREATE INDEX IF NOT EXISTS idx_directives_task_type ON directives(task_type_code);

-- ---------------------------------------------------------------------------
-- 5. ORPHAN AUDIT VIEW — heartbeats whose agent_session has no registered agent.
--    Nightly job: SELECT * FROM orphan_heartbeats; any row here = integrity breach.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS orphan_heartbeats;
CREATE VIEW orphan_heartbeats AS
SELECT h.heartbeat_uuid, h.colloquy_uuid, h.turn_uuid, h.emitted_at, h.event_kind
FROM heartbeats h
LEFT JOIN agent_sessions s
  ON h.turn_uuid IN (SELECT t.turn_uuid FROM turns t WHERE t.speaker_session_uuid = s.session_uuid)
LEFT JOIN agents a
  ON s.agent_uuid = a.agent_uuid
WHERE a.agent_uuid IS NULL;

-- ---------------------------------------------------------------------------
-- 6. WITNESS CHAIN AUDIT VIEW — terminal claims (assertion/uuid_mint/memory_write)
--    that lack an ancestor witness_signoff reaching root. Colloquy cannot CLOSE
--    with any row here.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS unsigned_terminal_claims;
CREATE VIEW unsigned_terminal_claims AS
WITH RECURSIVE ancestry(descendant, ancestor) AS (
  SELECT heartbeat_uuid, parent_heartbeat_uuid
    FROM heartbeats
    WHERE event_kind IN ('assertion', 'uuid_mint', 'memory_write')
  UNION ALL
  SELECT a.descendant, h.parent_heartbeat_uuid
    FROM ancestry a
    JOIN heartbeats h ON h.heartbeat_uuid = a.ancestor
    WHERE h.parent_heartbeat_uuid IS NOT NULL
)
SELECT DISTINCT h.heartbeat_uuid, h.colloquy_uuid, h.event_kind, h.event_label
FROM heartbeats h
WHERE h.event_kind IN ('assertion', 'uuid_mint', 'memory_write')
  AND NOT EXISTS (
    SELECT 1 FROM ancestry a
    JOIN heartbeats w ON w.heartbeat_uuid = a.ancestor
    WHERE a.descendant = h.heartbeat_uuid
      AND w.event_kind = 'witness_signoff'
  );

-- ---------------------------------------------------------------------------
-- 7. COLLOQUIES — add codebook pin at birth for replay determinism.
-- ---------------------------------------------------------------------------

ALTER TABLE colloquies ADD COLUMN codebook_version_at_birth TEXT;
ALTER TABLE colloquies ADD COLUMN witness_policy_default TEXT DEFAULT 'parent_required'
  CHECK (witness_policy_default IN ('parent_required', 'self_signed_ok', 'human_escalate'));
ALTER TABLE colloquies ADD COLUMN max_spawn_depth INTEGER NOT NULL DEFAULT 8
  CHECK (max_spawn_depth >= 0 AND max_spawn_depth <= 15);

-- ---------------------------------------------------------------------------
-- 8. MIGRATION STAMP
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT
);

INSERT OR IGNORE INTO schema_migrations (version, applied_at, description)
VALUES ('0.0.2', unixepoch() * 1000,
        'witness chain + spawn_depth + agent birth ritual + codebook pinning + icosphere codebook projection');
