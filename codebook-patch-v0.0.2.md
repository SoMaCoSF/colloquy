<!-- =============================================================================== file_id: SOM-DOC-7856-v1.0.0 name: codebook-patch-v0.0.2.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

<!-- =============================================================================== file_id: SOM-DOC-7856-v1.0.0 name: codebook-patch-v0.0.2.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

---
file_id: SOM-DOC-0054-v0.1.0
name: codebook-patch-v0.0.2.md
description: Codebook additions for colloquy v0.0.2 — applies on top of
  v2.4.0 to produce v2.5.0. §13 amendments (4 new event_kinds), new §16
  AGENT BIRTH, §17 WITNESS CHAIN, §18 SPAWN DEPTH. Plus type registry
  additions 0x00B AGENT_BIRTH, 0x00C DIRECTIVE.
category: DOC
tags: [codebook, patch, colloquy, v2.5.0, witness, spawn, agent-birth]
created: 2026-04-22
modified: 2026-04-22
version: 0.1.0
agent_id: claude-sonnet-4-5
---

# Codebook Patch — v2.4.0 → v2.5.0

**Bump rationale:** Introduces three new sections (§16 Agent Birth,
§17 Witness Chain, §18 Spawn Depth) and four new event_kinds in §13,
plus two new type code reservations (`0x00B`, `0x00C`). Minor bump
because everything is additive — no existing semantics change. Going
to v2.5.0 (not v2.4.1) because the agent-birth ritual is a materially
new contract for anyone spawning subagents, not a clarification of
existing behavior.

**Estimated token delta:** +1400 (≈ 2.8 KB). New total ≈ 7600 tok.

## Apply

1. Edit `app/api/lib/codebook.ts`:
   - Set `CODEBOOK_VERSION = '2.5.0'`
   - Set `CODEBOOK_ESTIMATED_TOKENS = 7600`
   - Add type registry entries in §3 (see below)
   - Append to §13's event_kinds table (see below)
   - Append §16-§18 verbatim (see below)
2. Backup before edit: `cp codebook.ts codebook.ts.bk4`
3. Apply schema migration: `turso db shell <db> < .claude/skills/colloquy/schema/colloquy-v0.0.2-migration.sql`
4. Re-seed Mini Turso: `node mini/openclaw/seed-codebook.mjs`
   (this mints a `vertex-v{N+1}` codebook_versions row)
5. Reload agent context: `vcmd reload` or restart daemon
6. Verify: `vcmd codebook` should show v2.5.0 for current-gen agents
7. Note: existing agents born under v2.4.0 remain on v2.4.0 — do NOT
   force-upgrade. See §16 on codebook pinning.

## §3 Type Registry — additions

Insert under the existing `0x00X` block (AGENT 0x002, SUBAGENT 0x003
already exist from prior codebook):

```typescript
{ code: 0x00B, name: 'AGENT_BIRTH',
  desc: 'Audit anchor for a single agent spawn event; referenced by agents.birth_heartbeat_uuid' },
{ code: 0x00C, name: 'DIRECTIVE',
  desc: 'Reusable mission brief; minted only for directives that earn identity (templates, shared, audited)' },
```

## §13 event_kinds — additions

Append to the existing table in §13. Full schema for each is in
`references/heartbeat-taxonomy.md` §v0.0.2.

| kind              | fires when                                                    | emitter              |
|-------------------|---------------------------------------------------------------|----------------------|
| `agent_birth`     | New agent completes UUID mint + registry write + codebook pin | instrumented         |
| `witness_signoff` | Parent session confirms a child's terminal claim              | agent explicit       |
| `witness_refusal` | Parent session rejects a child's claim                        | agent explicit       |
| `witness_deferred`| Parent escalates judgment upward (e.g., to human)             | agent explicit       |

Registry size is now **15 event_kinds**. Governance rule unchanged:
further extension requires a codebook bump.

## §16 AGENT BIRTH — verbatim

```markdown
## 16. AGENT BIRTH — the spawn ritual

Spawning a subagent is a ritual, not a function call. Every spawn
produces three artifacts atomically, or the spawn fails:

1. **UUID mint** — child's GYST UUID (type `0x002 AGENT` or
   `0x003 SUBAGENT`), deterministic from
   (`parent_agent_uuid + timestamp + nonce`). The `depth(4)` field
   encodes spawn_depth = parent.spawn_depth + 1. The `generation(4)`
   field encodes the codebook major version at birth.

2. **Registry write** — row in `agents` table with: parent_agent_uuid,
   spawn_depth, codebook_version_at_birth, directive_json (or
   directive_uuid reference), birth_heartbeat_uuid, witness_policy,
   model_id, role, provenance.

3. **Codebook pin** — `codebook_version_at_birth` is immutable for the
   agent's entire life. Capabilities are frozen at birth. Future
   codebook bumps affect only new spawns.

The ritual has three entrypoints, all calling the same binary
(`scripts/spawn-agent.mjs`):

- **Skill** `spawning-a-subagent` — ergonomic LLM-facing entrypoint.
  Forces the parent to declare task_type_code, directive, witness
  stance before the ritual runs. Richer spawns.
- **CLI** `vcmd spawn` — human-initiated and cross-machine (SPOCTALK)
  entrypoint. Carries Ed25519 signature when crossing a machine
  boundary.
- **Hook** PreToolUse on `Agent` tool — structural enforcer. Makes the
  ritual unskippable. A tool-level bypass is a structural violation
  that trips `orphan_heartbeats` audit.

The enforcement layer is the hook. The skill and CLI are the richer
ergonomic and cross-boundary entrypoints respectively; without the
hook, they are advisory. Without the skill, the hook still runs with
inferred defaults. Spawning is required to go through AT LEAST the
hook, or the resulting agent is not a citizen.

### Directive

The mission brief the parent hands to the child. Minimum fields:
`task_type_code`, `scope.tools`, `scope.max_spawn_depth`,
`scope.budget_tokens`, `witness_policy`, `codebook_v`, `deadline_s`.

`witness_policy` is one of: `parent_required` (parent WILL emit
signoff/refusal — default), `self_signed_ok` (child's own assertion
accepted — use sparingly for trivial work), `human_escalate` (every
terminal claim is a `witness_deferred` to a human session).

Ephemeral directives live inline in `agents.directive_json`. Reusable
directives (templates) mint a `0x00C DIRECTIVE` UUID and are referenced
by UUID. Shared directives earn identity; one-shots don't.

### Failure modes

- Daemon offline → hook falls back to `agents_pending` scratch table,
  reconciles on daemon return. Fail-safe, not fail-closed.
- FK rejection → `BirthRefused` error, no heartbeat emitted, parent
  retries or escalates.
- Ritual bypass → orphan heartbeats surface in `orphan_heartbeats`
  view; colloquy flagged `integrity_compromised`; post-hoc registration
  only under `witness_deferred` to human.
- Cross-machine sig invalid → target machine NACKs with
  `signature_invalid`; no registry write on either side.

### The payoff

No anonymous workers. Every agent in a swarm has a birth certificate,
a parent who witnessed its birth, a codebook that defines what it can
say, and a spawn_depth from the root human intent. That is what
"Identity Is Infrastructure" means at the swarm level — not just
UUIDs on outputs, but citizenship for every agent that produces them.
```

## §17 WITNESS CHAIN — verbatim

```markdown
## 17. WITNESS CHAIN — who stands behind every claim

A **witness** is the parent heartbeat's owning agent_session. A
**witness signature** is a `witness_signoff` heartbeat whose
`witnesses_heartbeat_uuid` references a child's terminal claim
(`assertion`, `uuid_mint`, or `memory_write`). The DAG edges already
encode delegation; the signoff edges encode endorsement.

### The contract

- Every terminal claim in a colloquy MUST have an ancestor signoff
  chain reaching the colloquy's root session (the initiator).
- A colloquy CANNOT enter `CLOSED` while `unsigned_terminal_claims`
  returns any rows for it. The state machine promotes to `PROMOTING?`
  until signoffs land or a human intervenes.
- A signoff from the same session that emitted the claim is valid
  only if the agent's `witness_policy = 'self_signed_ok'`. Self-sig
  is legitimate but epistemically weaker.
- Refused claims (`witness_refusal`) are NOT deleted. They remain in
  the tree as learning evidence — the "things agents almost did wrong"
  corpus.

### Cross-machine witnesses

Intra-machine trust comes from PK+FK graph integrity — tampering is
detectable by any walk. Cross-machine trust (SPOCTALK boundary)
requires an Ed25519 signature in the signoff heartbeat's payload. The
signing key is the parent agent's registered key; verification uses
the peer machine's cached public key. A signoff across machines
without a valid sig is rejected at INSERT.

### Attribution is mechanical

Vertex's v0.0.1 review flagged: "did I retract because I changed my
mind or because the human corrected me?" The witness chain answers
mechanically. `witnessed_by_session_uuid == self` means internal
reasoning shift. `witnessed_by_session_uuid == human_session` means
external correction. `witnessed_by_session_uuid == peer_session`
means peer-agent adjudication. No separate intent_source field
needed; attribution falls out of the session UUID.

### Deferrals terminate cleanly

`witness_deferred` escalates judgment upward with a timeout. The
escalation target MUST subsequently emit `witness_signoff` or
`witness_refusal` on the deferred heartbeat. If the timeout elapses
unresolved, the colloquy enters `PROMOTING?` and blocks close until a
human operator signs or explicitly closes with
`integrity_compromised`.

### The payoff

Every claim in the system is traceable to a named accountable party,
with no orphan authority. Audit is a one-query walk. Fine-tuning can
filter by depth-of-witness for quality tiers. Non-repudiation exists
where it matters (cross-machine) and is absent where it would be
wasteful (intra-machine). The witness chain is the part of the
infrastructure that makes the identity claim — "every UUID is a
compressed epistemic statement" — defensible at the action level, not
just the naming level.
```

## §18 SPAWN DEPTH — verbatim

```markdown
## 18. SPAWN DEPTH — the resource axis of the swarm

There are three depth concepts in colloquy-world, and they must not
be confused:

| Axis                       | Field                         | Measures                                  |
|----------------------------|-------------------------------|-------------------------------------------|
| Type-hierarchy depth       | `GYST.depth(4)` on type UUIDs | Position in the UUID-type tree            |
| Within-turn branch depth   | `heartbeats.branch_depth`     | Position in one turn's causal DAG         |
| **Agent spawn depth**      | `agent_sessions.spawn_depth`  | Hops from root human intent through agents|

For agent UUIDs specifically, `depth(4)` is repurposed to carry
spawn_depth (since agents are leaves in the type tree, their
type-depth bits are free). Readable from the UUID alone.

### Budget

- Colloquy default `max_spawn_depth = 8` (configurable per colloquy,
  0..15).
- A session at `spawn_depth == max_spawn_depth` MUST refuse further
  spawns. Attempting one raises `BirthRefused(depth_exceeded)`.
- At `spawn_depth == 15`, the 4-bit UUID field overflows. Mint is
  impossible by construction. This is a structural circuit breaker,
  not a policy toggle.

### Graceful exhaustion via fork

When a session hits its cap and still needs subagents, it promotes
the remaining work to a new colloquy via `colloquy_forks`. The fork
resets `spawn_depth` to 0 in the forked colloquy. Lineage is
preserved in `colloquy_forks.from_heartbeat`, so the chain remains
walkable across the promotion boundary. Analog: stack overflow → new
process with a fresh stack frame.

### Epistemic discount

A default trust filter for depth-sensitive queries:

```
effective_trust = signal × (1 - ε)^spawn_depth      (ε ≈ 0.03)
```

At signal 0xFFFF, depth 1 ≈ 0xF831 (near-gold). Depth 8 ≈ 0xC9B0
(materially softer). Depth 15 ≈ 0xA23F (half-trust). This is the
mathematical articulation of "claims that traveled farther from root
human intent are less trusted by default." Applied as a WHERE clause:
`effective_trust >= 0xC000`.

### Swarm archetypes by depth distribution

Beyond the four agent archetypes (Confident Executor, Cautious
Explorer, Thrasher, Promoted Skeptic), depth distribution classifies
swarm shapes:

- **Starburst** — most heartbeats at depth=1. Flat map-reduce.
- **Deep-Dive** — monotone chain, depths 1..N with N large. Drill-down
  investigation.
- **Mesh** — varied depths with `parallel_merge` heartbeats. Consensus
  building.
- **Cascading Gardener** — deep chain with signoff heartbeats from
  leaves back up. Compliance/audit-heavy work.

Shape is readable from heartbeat UUID bits alone via
`SELECT depth, COUNT(*) FROM heartbeats ... GROUP BY depth` with no
row reads.
```

## Post-apply checklist

- [ ] Verify `CODEBOOK_VERSION === '2.5.0'`
- [ ] Verify `CODEBOOK_ESTIMATED_TOKENS ≈ 7600` (via tiktoken actual)
- [ ] Apply `colloquy-v0.0.2-migration.sql` — verify
      `SELECT version FROM schema_migrations` returns `'0.0.2'`
- [ ] Re-render `/vertex/codebook` — confirm §16-§18 + new event_kinds
- [ ] Re-seed Mini Turso: `node mini/openclaw/seed-codebook.mjs`
- [ ] Restart openclaw daemon to reload codebook blob
- [ ] Spawn a test subagent via `vcmd spawn` — verify registry row +
      `agent_birth` heartbeat + correct `codebook_version_at_birth`
- [ ] Attempt a ritual bypass (call Agent tool with hook disabled) —
      verify `orphan_heartbeats` view catches it at next audit
- [ ] Ping Vertex: `vcmd chat "what sections does codebook v2.5.0 add?"`
      — expect §16-§18 enumerated with the 4 new event_kinds
