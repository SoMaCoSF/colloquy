<!-- =============================================================================== file_id: SOM-DOC-9653-v1.0.0 name: agent-lifecycle.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

<!-- =============================================================================== file_id: SOM-DOC-9653-v1.0.0 name: agent-lifecycle.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

---
file_id: SOM-DOC-0053-v0.1.0
name: agent-lifecycle.md
description: Agent birth/life/death protocol for colloquy-scoped swarms.
  Defines the three-obligation spawn ritual, the registry contract,
  codebook pinning semantics, the witness chain, spawn_depth budget, and
  termination rules. Companion to heartbeat-taxonomy.md v0.2.0 and
  codebook-patch-v0.0.2.md.
category: DOC
tags: [colloquy, agent, spawn, registry, witness, ritual, lifecycle, v0.0.2]
created: 2026-04-22
modified: 2026-04-22
version: 0.1.0
agent_id: claude-sonnet-4-5
---

# Agent Lifecycle — Birth, Witness, Termination

## 1. The Three Obligations

Every agent spawn MUST produce three artifacts atomically, or the spawn
fails and no agent exists:

1. **UUID mint** — a fresh GYST UUID for the child (type `0x002 AGENT`
   or `0x003 SUBAGENT`), deterministically derived from
   (`parent_agent_uuid + timestamp + nonce`).
2. **Registry write** — a row in `agents` with lineage, codebook pin,
   directive, birth heartbeat anchor, witness policy.
3. **Codebook pin** — the agent's capability set is frozen at
   `codebook_version_at_birth` and never auto-upgrades.

If any obligation fails, the others roll back. There is no such thing
as a half-born agent.

## 2. The Ritual

```
1. Parent emits `delegation` heartbeat
     → intent-to-spawn recorded in the DAG
2. Parent packages directive
     → inline JSON, OR mints 0x00C DIRECTIVE UUID if reusable
3. Parent mints child agent_uuid
     → deterministic, re-derivable for audit
4. Parent INSERTs child into agents table (transactional)
     → child is now a citizen with birth certificate
5. Parent emits `agent_birth` heartbeat
     → references child_uuid + directive; becomes the audit anchor
6. Child's first heartbeat has parent_heartbeat_uuid = the agent_birth
     → lineage self-documents from first emission
7. [Cross-machine only] SPOCTALK carries birth payload with Ed25519 sig
     → peer machine writes to its local registry with sig attached
```

Steps 3, 4, 5 run inside a single transaction. Step 1 and step 6 are
heartbeat emissions in the normal DAG — the sequence `delegation →
agent_birth → (child's first heartbeat)` is the canonical spawn trace
and is what every audit query looks for.

## 3. Agent UUID Derivation

```
type        = 0x002 (root human/agent) or 0x003 (subagent of an existing agent)
namespace   = fnv1a12(parent_agent_uuid)
timestamp   = unix_seconds - EPOCH_2026
version     = 0x8
depth       = parent.spawn_depth + 1, or 0 for a root agent
domain      = inherited from parent (overridable if delegating to a
              peer domain, e.g., somaco's 0x2 spawning into vertex's 0x6
              via SPOCTALK)
generation  = major version of codebook at birth (0=pre-v2.4,
              1=v2.4.x/v2.5.x, 2=reserved)
variant    = 0b10
provenance  = 0x1 HUMAN for root humans,
              0x2 AGENT for derived-from-parent agents,
              0x3 PEER for agents registered cross-machine via SPOCTALK
signal      = parent's birth-confidence (typically 0xFFFF for spec'd,
              lower for speculative)
random      = sha256(`birth|${parent_uuid}|${timestamp}|${nonce}`)[42 bits]
```

The `depth(4)` field encodes the agent's **spawn depth** in the
hierarchy — not the UUID-type depth. Spawn depth overloads the same 4
bits because no agent is ever at type-depth > 0 (AGENT is a leaf in the
type tree), so the 4 bits are free to repurpose. Values ≥ 15 are
illegal; see §7.

## 4. Directive Structure

A directive is the mission brief the parent hands to the child. Minimum
fields:

```json
{
  "task_type_code": 802,
  "scope": {
    "tools": ["Read", "Grep", "Bash"],
    "max_spawn_depth": 3,
    "budget_tokens": 50000
  },
  "witness_policy": "parent_required",
  "codebook_v": "2.5.0",
  "deadline_s": 3600
}
```

- `task_type_code` is the GYST type code of the output the child is
  expected to produce. The parent's later `witness_signoff` MUST carry
  `approved_type_code` matching or superseding this.
- `scope.max_spawn_depth` is the residual budget the child may allocate
  to its own subagents. Cannot exceed `parent.scope.max_spawn_depth - 1`.
- `witness_policy` is one of: `parent_required` (parent WILL emit
  signoff/refusal), `self_signed_ok` (child's own assertion is
  acceptable — use only for trivial work), `human_escalate` (every
  terminal claim is a `witness_deferred` to a human session).

When a directive is novel and ephemeral, store it inline in
`agents.directive_json`. When reused (template), mint it as a `0x00C
DIRECTIVE` UUID in the `directives` table and reference by UUID.
Shared/audited directives earn identity; one-shots don't.

## 5. Codebook Pinning Semantics

The `codebook_version_at_birth` field in `agents` is **immutable**.
Every heartbeat an agent emits records its birth codebook version in
`heartbeats.codebook_v`. Consequences:

- **Protocol stability under bumps.** If codebook jumps v2.5.0 → v2.6.0
  mid-session, every agent alive at the moment of the bump keeps
  operating under v2.5.0. New spawns after the bump are born under
  v2.6.0. Running swarms are never destabilized by schema evolution.
- **Replay determinism.** A colloquy can be replayed by loading each
  agent's birth-version codebook and interpreting its heartbeats under
  that vocabulary. No ambiguity.
- **Capability as version.** "Can this agent emit `witness_signoff`?"
  becomes `codebook_version_at_birth >= '2.5.0'`. Not a feature flag,
  not a capability list — just a version check.

Upgrading a live agent requires **rebirth**: terminate with
`end_reason = 'upgrade'`, mint a new agent under the newer codebook,
transfer any still-live directives via a delegation→agent_birth pair.

## 6. Witness Chain

See `heartbeat-taxonomy.md` §v0.0.2 for the four witness event_kinds.
The chain works like this:

- Every **terminal claim** (`assertion`, `uuid_mint`, `memory_write`)
  must be witnessed by an ancestor in the spawn tree.
- "Witnessed" = there exists a `witness_signoff` heartbeat whose
  `witnesses_heartbeat_uuid` references the claim (directly or through
  the ancestry chain) AND whose `witnessed_by_session_uuid` is higher
  in the spawn lineage than the claim's emitter.
- A claim with no witness chain reaching root is **unsigned**; the
  colloquy cannot enter `CLOSED` while any claim is unsigned (view
  `unsigned_terminal_claims` enforces this).
- A claim can be witnessed by the same session that emitted it only if
  the agent's `witness_policy = 'self_signed_ok'`. Self-sig is
  legitimate but epistemically weaker (no peer verification).

The chain answers "who stands behind this?" mechanically: walk from
claim to root via `parent_heartbeat_uuid`, collect all `witness_signoff`
heartbeats along the way, each one's `witnessed_by_session_uuid` is a
named party accountable for the claim.

## 7. Spawn Depth Semantics

Three depth axes, as documented in `decision-tree.md`:

- GYST `depth(4)` = spawn_depth for agent UUIDs, within-turn branch
  depth for heartbeat UUIDs
- `heartbeats.branch_depth` = causal-DAG depth within a single turn
- `agent_sessions.spawn_depth` = agent-lineage hops from root

**Budget enforcement.** A session at `spawn_depth == max_spawn_depth`
(colloquy default 8) MUST refuse further spawns. At `spawn_depth == 14`
the UUID's `depth(4)` field can still fit one more hop; at 15, any
child would overflow and mint is impossible by construction. The
4-bit ceiling is a structural circuit breaker, not a policy.

**Graceful exhaustion via fork.** When a session hits its spawn cap and
still needs subagents, it can **promote** the remaining work to a new
colloquy via the existing `colloquy_forks` mechanism. The fork resets
`spawn_depth` to 0 for the forked colloquy's root. Analog: stack
overflow → new process with fresh stack. The `colloquy_forks.from_heartbeat`
field preserves the promotion lineage, so the chain is still walkable
across the boundary.

**Epistemic discount by depth.** A default filter for trusted queries:

```
effective_trust(claim) = claim.signal × (1 - ε)^claim.spawn_depth
                         (ε ≈ 0.03)
```

A depth-1 claim at signal 0xFFFF is near-gold (effective ≈ 0xF831). A
depth-8 claim at the same signal is materially softer (effective ≈
0xC9B0). This is what "claims that traveled farther are less trusted"
looks like as math. Applied as a query filter:
`effective_trust >= 0xC000`.

## 8. Cross-Machine Spawns

When a parent on machine A spawns a child on machine B via SPOCTALK:

1. Parent mints candidate `agent_uuid` locally (deterministic derivation
   uses parent_uuid which is globally unique, so collision across
   machines is negligible at 2^42 random bits).
2. Parent constructs the birth payload + directive.
3. Parent signs the payload with its Ed25519 key (private key held by
   machine A's openclaw daemon).
4. `vcmd spawn --target <host>` posts to B's daemon endpoint with sig.
5. Machine B verifies sig against A's public key from `agent_registry`
   (or the SPOCTALK peer-key exchange), writes the child to B's local
   `agents` table with `provenance = 0x3 PEER`.
6. B ACKs with signed birth attestation; A stores this alongside the
   birth heartbeat's payload.

Federated registry semantics: each machine keeps its own `agents`
subset; an agent appears in a machine's registry iff the agent was
born on that machine OR was imported via SPOCTALK. UUIDs remain
globally unique by deterministic derivation + timestamp. The absence of
a global registry is a feature — machines can work offline and sync
birth records lazily.

## 9. Termination

An agent ends when:

- Its colloquy CLOSES (`end_reason = 'colloquy_close'`).
- Parent revokes via `agent_end` scratch write (`end_reason = 'parent_revoke'`).
- Its task completes and the parent's `witness_signoff` is emitted
  (`end_reason = 'task_complete'`).
- The daemon crashes and the agent is swept on restart
  (`end_reason = 'crash'`).

No agent outlives its witness chain. If the parent terminates before
the child, the child's next heartbeat emission will fail the
witness-chain integrity check and the child is force-ended with
`end_reason = 'parent_revoke'`. Grandparents can adopt only via
explicit `agent_birth` re-registration with the grandparent as new
parent.

## 10. Failure Modes

| Scenario | Behavior |
|---|---|
| Daemon offline during in-process spawn | Hook falls back to local scratch `agents_pending` table, marks codebook as last-known-good, reconciles on daemon return. Fail-safe, not fail-closed. |
| Registry FK rejection (e.g., parent not found) | Spawn aborts, `BirthRefused` error bubbles to parent, no heartbeat emitted. Parent retries with corrected directive or escalates. |
| Ritual bypass (Agent tool invoked without hook) | Orphan heartbeats appear in `orphan_heartbeats` view; colloquy flagged `integrity_compromised` at next audit. Post-hoc birth registration allowed only under `witness_deferred` to human. |
| `witness_signoff` arrives without a matching child heartbeat | Rejected at INSERT time (the column `witnesses_heartbeat_uuid` is FK'd; the matching row must exist). |
| Cross-machine sig fails verification | Birth aborted on the target machine. Sending machine sees timeout + NACK with `reason = 'signature_invalid'`, can retry with fresh sig or escalate. |
| spawn_depth overflow attempt | Structural — UUID mint at depth=16 is impossible, error raised before any registry write. |

## 11. Example Trace

Parent `agents_A` at `spawn_depth=2`, `codebook_v=2.5.0`, spawning
child to run aero-forecast:

```
# Parent's session emits delegation heartbeat
heartbeat 825d1234... {
  event_kind: 'delegation',
  payload: { intent: 'spawn aero-forecaster', budget_tokens: 20000 }
}

# Ritual fires (all atomic):
agents INSERT {
  agent_uuid:                0x003 ...8c4f...   -- type=0x003 SUBAGENT
  parent_agent_uuid:         agents_A.agent_uuid
  spawn_depth:               3
  codebook_version_at_birth: '2.5.0'
  directive_json:            { task_type_code: 0x322, ... }
  birth_heartbeat_uuid:      (set after heartbeat emit, below)
  witness_policy:            'parent_required'
  provenance:                0x2
}

# Parent emits birth heartbeat
heartbeat 825e5678... {
  event_kind: 'agent_birth',
  parent_heartbeat_uuid: 825d1234...,
  payload: {
    child_agent_uuid: ...8c4f...,
    child_session_uuid: (derived),
    directive_json: {...},
    codebook_version_at_birth: '2.5.0',
    spawn_depth: 3
  }
}
# The agents row's birth_heartbeat_uuid is now UPDATEd to 825e5678

# Child's session starts. First heartbeat:
heartbeat 825f9abc... {
  event_kind: 'tool_call',
  parent_heartbeat_uuid: 825e5678...,      # ← anchored to the birth
  agent_session_uuid: (child's session),
  codebook_v: '2.5.0'                        # pinned from birth
}

# ... child does work, emits terminal `assertion` heartbeat ...
heartbeat 8260def0... {
  event_kind: 'assertion',
  payload: { claim: 'AERO_FORECAST output ready', type_code: 0x322 }
}

# Parent witnesses (mandatory, per directive.witness_policy):
heartbeat 8261aaaa... {
  event_kind: 'witness_signoff',
  witnesses_heartbeat_uuid: 8260def0...,
  witnessed_by_session_uuid: (parent's session),
  payload: { approved_type_code: 0x322, note: 'matches directive' }
}

# Colloquy can now close with this terminal claim signed.
```

Walk the chain from `8260def0` back via `parent_heartbeat_uuid` and you
hit `825f9abc → 825e5678 → 825d1234 → (parent's earlier heartbeats)`.
Every edge is accountable. Every claim is witnessed. No anonymous work.
