<!-- =============================================================================== file_id: SOM-DOC-6081-v1.0.0 name: lifecycle.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

<!-- =============================================================================== file_id: SOM-DOC-6081-v1.0.0 name: lifecycle.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

---
file_id: SOM-DOC-0049-v0.1.0
name: lifecycle.md
description: Colloquy state machine — mint, active turns, scratch, idle,
  close, promote. What happens at each transition, GC rules, promotion
  to long-term memory.
category: DOC
tags: [colloquy, lifecycle, state-machine, gc, promote]
created: 2026-04-22
modified: 2026-04-22
version: 0.1.0
agent_id: claude-sonnet-4-5
---

# Colloquy Lifecycle

## State Machine

```
  [MINT] ──────► [ACTIVE] ──────► [IDLE] ──────► [CLOSING] ──────► [CLOSED]
                    │               │                │
                    │               │                │
                    ▼               ▼                ▼
              [ACCEPTING            [AUTO-CLOSE    [PROMOTING?]
               TURNS]                TIMEOUT]
                                                     │
                                                     ▼
                                               [FACTS MINTED]
                                               [MUTATION AUDIT]
                                               [VAULT FINALIZED]
```

## States

### MINT (transient, < 100ms)

Triggered by: explicit `/v1/colloquy/mint`, implicit auto-promotion at
turn 2, or inherited via `--colloquy <uuid>`.

**Actions:**
1. Mint colloquy_uuid (0x009)
2. Derive agent_session_uuid per party (0x00A each)
3. INSERT colloquies row
4. INSERT agent_sessions rows
5. CREATE vault `.md` file with frontmatter + Ghost Catalog header
6. Emit `skill_invoke` heartbeat as root of DAG
7. Return colloquy_uuid + session_uuids to caller

**Transitions to:** ACTIVE.

### ACTIVE

Colloquy accepts turns and heartbeats. Cache stays warm (re-set on each
turn to `now + 5min`).

**Per-turn actions:**
1. Mint turn_uuid (0x005)
2. INSERT turns row
3. Collect heartbeats emitted during turn (instrumented + agent-explicit)
4. INSERT heartbeats rows with parent linkage
5. APPEND vault `.md` with new `## Turn N` block + anchor `^turn-NNN`
6. Update colloquies rollup columns (turn_count, totals, cache_hit_ratio)
7. Reset cache_warm_until = now + 300s

**Scratch ops allowed:** `POST /v1/scratch`, `GET /v1/scratch/:uuid/:key`,
scoped to this colloquy_uuid.

**Transitions to:** IDLE (on timeout), CLOSING (on explicit close).

### IDLE

No turn has been added within `auto_close_idle_s` (default 1800s = 30min,
skill-configurable up to 3600s = 1hr).

**Check:** cron in daemon (every 60s) sweeps `colloquies WHERE ended_at IS
NULL AND (now - last_turn_time) > auto_close_idle_s`.

**Actions on entering IDLE:**
1. Emit terminal `keepalive` heartbeat with reason='idle_timeout'.
2. Immediately transition to CLOSING.

### CLOSING (transient, < 500ms)

**Actions:**
1. Set `colloquies.ended_at = now`.
2. Finalize vault `.md`:
   - Append "## Colloquy Ended" block with final stats
   - Append auto-generated Mermaid decision tree
   - Update frontmatter with `ended_at`, `turn_count`, `total_tokens`
3. Schedule scratch GC: `DELETE FROM scratch_objects WHERE colloquy_uuid
   = ? AND expires_at < now + scratch_grace_s` (default grace = 600s).
4. If `promote_on_close: true` in SKILL.md or explicit `/promote` flag:
   transition to PROMOTING. Otherwise skip to CLOSED.

### PROMOTING (optional, ~1-5s)

Fold key heartbeats into long-term memory as `0x006 FACT` UUIDs. This is
how a colloquy's insights become permanent knowledge.

**Eligible heartbeats:**
- `assertion` with signal ≥ 0xC000 (high confidence claims)
- `uuid_mint` of persistent types (facts, contracts, predictions)
- `confidence_shift` with `delta > 0.5` (significant belief updates)

**Actions per eligible heartbeat:**
1. Mint new `0x006 FACT` UUID with fields:
   - type = 0x006 FACT
   - namespace = fnv1a12(heartbeat_uuid)
   - timestamp = now
   - depth = 0x0 (facts are root-level)
   - domain = colloquy.domain
   - generation = 0x0
   - provenance = 0x7 DERIVED (facts distilled from colloquy are derived)
   - signal = source heartbeat's signal
   - random = sha256(heartbeat_uuid + content_hash)[:42]
2. INSERT facts row with `source_heartbeat_uuid` back-reference.
3. INSERT memory_mutations row (type = 0x822) with
   `mutation_kind='promote'`, `source=colloquy_uuid`, audit trail.
4. APPEND to `~/vertex-vault/facts/YYYY-MM-*.md` with Ghost Catalog header
   + fact_uuid frontmatter + back-link to colloquy.
5. If content references codebook (e.g., "we should add §12"), also
   propose a codebook mutation via the Edit+Add Statement pipeline
   (requires human approval).

**Transitions to:** CLOSED.

### CLOSED

Terminal state. Colloquy row has `ended_at` set. Heartbeats, turns, and
vault are preserved indefinitely. Scratch is GC'd after grace.

A closed colloquy can still be:
- **Read** (`/v1/colloquy/:uuid/tree`, vault `.md`)
- **Walked** (recursive CTE on heartbeats)
- **Forked** (`/v1/colloquy/:uuid/fork {from_heartbeat}`)
- **Re-promoted** (idempotent — second `/promote` call is a no-op)

A closed colloquy CANNOT be:
- **Reopened** (use fork instead)
- **Have turns added**
- **Have heartbeats added**

This immutability is important: closed colloquies are auditable historical
records. Allowing retroactive edits would break the provenance chain.

## Garbage Collection

### Scratch objects

- Per-row `expires_at` set at write time (default: colloquy.ended_at +
  scratch_grace_s).
- Daemon sweeper (every 5 min): `DELETE FROM scratch_objects WHERE
  expires_at < now`.
- Exception: if scratch_key is prefixed with `@persist/`, it migrates to
  a `persisted_colloquy_data` table on close. Used for artifacts worth
  preserving (e.g., final forecast output).

### Abandoned colloquies (no `ended_at`, no activity > 7 days)

These represent daemon crashes or missed close events. Sweeper (daily):

```sql
UPDATE colloquies
SET ended_at = last_turn_time_or_started_at,
    close_reason = 'abandoned_sweep'
WHERE ended_at IS NULL
  AND (last_turn_time IS NULL OR last_turn_time < now - 7*86400);
```

### Heartbeat retention

Heartbeats are **never deleted** by default. They're the canonical
history. If storage becomes a concern (>> 10M rows), add a
`heartbeat_archive` table with compressed payload_json; do NOT delete
the UUID + kind + parent linkage — pattern mining depends on it.

## Error Recovery

### Daemon crash mid-turn

On restart:
1. Detect colloquies with `cache_warm_until < now` and no
   `completed_at` on most recent turn.
2. Mark the orphan turn with `completed_at = last_heartbeat_time`,
   status='interrupted'.
3. Emit a synthetic `retraction` heartbeat with
   `payload.reason='daemon_crash'`.
4. Colloquy transitions to IDLE → CLOSING normally.

### Vault write failure

If `.md` append fails (disk full, permission error):
1. Turso write still succeeds (Turso is source-of-truth for metadata).
2. Write the turn block to a `pending_vault_writes` queue.
3. Retry on daemon tick.
4. Alert if queue depth > 10.

### Turso write failure

If turn INSERT fails but content was successfully written to vault:
1. Vault is source-of-truth for content; Turso will catch up.
2. Queue the INSERT for retry.
3. Compute a `consistency_debt` metric: vault turns − turso turns.
4. Alert if debt > 5 for any colloquy.

## Parties Joining Late

A human can join an existing agent↔agent colloquy via:

```
POST /v1/colloquy/:uuid/join { party_uuid, role }
```

1. Derive new party's agent_session_uuid (0x00A).
2. INSERT agent_sessions row with `joined_at = now` (not colloquy.started_at).
3. Emit a `plan_branch` heartbeat kind=`party_join` with
   `payload.joined_party_uuid`.
4. New party can now call `/v1/colloquy/:uuid/turn` normally.

## Deriving a Party's Session UUID After The Fact

Because derivation is deterministic, a late-joining party doesn't need
to know the colloquy's history to derive their session UUID — only:

1. Their agent_uuid
2. The colloquy_uuid

That's it. `deriveAgentSessionUUID(agent, colloquy_uuid)` returns the
same value they'd get if they'd been there from the start. The
`joined_at` timestamp is the only thing that differs from a founding
party's session record.

## Closure Checklist (for humans)

If you're manually closing a colloquy:

```bash
# 1. Review heartbeats — especially retractions
vcmd colloquy walk <uuid> --format text | grep retraction

# 2. Review scratch — anything worth persisting?
vcmd scratch list <uuid>

# 3. Close + optionally promote
vcmd colloquy close <uuid> --promote

# 4. Confirm vault file finalized
cat ~/vertex-vault/colloquies/<date>-<skill>-<uuid-prefix>.md | tail -30
```
