-- =============================================================================
-- file_id: SOM-SQL-0003-v0.0.3
-- name: 0003-sandbox.sql
-- description: Colloquy v0.0.3 sandbox layer (multi-tier reserved; Tier 3
--              Firecracker microVM is the only implemented modality).
--              ADDITIVE ONLY — safe to re-run. Bootstrap via
--              D:/somacosf/utils/scripts/bootstrap-sandbox-v003.mjs for
--              libsql one-statement-at-a-time with dup-column skips.
-- category: SQL
-- tags: [colloquy, sandbox, firecracker, v0.0.3]
-- created: 2026-04-22
-- =============================================================================

-- directives carry the sandbox POLICY (what tier the child MUST run in).
ALTER TABLE directives ADD COLUMN sandbox_tier INTEGER NOT NULL DEFAULT 3;
ALTER TABLE directives ADD COLUMN sandbox_config_json TEXT;

-- agents carry the sandbox FACT (what VM actually backed the birth).
ALTER TABLE agents ADD COLUMN sandbox_tier INTEGER DEFAULT 3;
ALTER TABLE agents ADD COLUMN sandbox_vm_id TEXT;
ALTER TABLE agents ADD COLUMN sandbox_rootfs_hash TEXT;
ALTER TABLE agents ADD COLUMN sandbox_booted_at INTEGER;

-- Lifecycle ledger. One row per provisioned sandbox.
-- tier: 1=Docker (reserved), 2=gVisor (reserved), 3=Firecracker (active).
-- state: provisioned -> booted -> running -> halted -> purged; 'stub' is a
--        terminal state for Windows/no-KVM dev boxes where we record intent
--        without actually spawning a VM.
CREATE TABLE IF NOT EXISTS sandboxes (
  sandbox_uuid    TEXT PRIMARY KEY,
  agent_uuid      TEXT,
  tier            INTEGER NOT NULL CHECK (tier IN (1,2,3)),
  vm_id           TEXT,
  socket_path     TEXT,
  kernel_path     TEXT,
  rootfs_path     TEXT,
  rootfs_hash     TEXT,
  mem_mib         INTEGER,
  vcpus           INTEGER,
  state           TEXT NOT NULL
                    CHECK (state IN ('provisioned','booted','running','halted','purged','stub')),
  provisioned_at  INTEGER,
  booted_at       INTEGER,
  halted_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sandboxes_agent ON sandboxes(agent_uuid);
CREATE INDEX IF NOT EXISTS idx_sandboxes_state ON sandboxes(state);
CREATE INDEX IF NOT EXISTS idx_sandboxes_tier  ON sandboxes(tier);
