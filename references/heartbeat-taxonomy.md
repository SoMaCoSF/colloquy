<!-- =============================================================================== file_id: SOM-DOC-3929-v1.0.0 name: heartbeat-taxonomy.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

<!-- =============================================================================== file_id: SOM-DOC-3929-v1.0.0 name: heartbeat-taxonomy.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

---
file_id: SOM-DOC-0046-v0.2.0
name: heartbeat-taxonomy.md
description: Full registry of heartbeat event_kinds. Canonical list of
  decision/action events that get emitted as 0x825 HEARTBEAT UUIDs.
  v0.2.0 adds four kinds for agent birth and witness chain (signoff,
  refusal, deferred). Extensible but registry-governed — new kinds
  require a codebook version bump.
category: DOC
tags: [colloquy, heartbeat, taxonomy, event-kind, witness, agent-birth]
created: 2026-04-22
modified: 2026-04-22
version: 0.2.0
agent_id: claude-sonnet-4-5
---

# Heartbeat Event Kind Registry

## Purpose

Heartbeats (`0x825`) are emitted at semantic decision or action points.
The `event_kind` field classifies each emission and determines its
`payload_json` schema.

This registry is **canonical and registry-governed**. Adding a new kind
requires a codebook version bump (same governance as type codes). Do
NOT invent new kinds locally — either use an existing one or propose
an addition.

## Registry

### `tool_call`

**Fires:** Before any tool invocation (Read, Bash, Edit, Grep, etc.).
**Provenance:** 0x2 AGENT (or 0x1 HUMAN if a human-issued command).
**Signal:** Agent's pre-call confidence in the tool producing useful output.
**Payload:**

```json
{
  "tool": "Read",
  "args_hash": "sha256(first 12 chars)",
  "expected_outcome": "file content for analysis"
}
```

**Emitted by:** Instrumented (SDK/daemon auto-emits on tool invocation).

### `skill_invoke`

**Fires:** When the Skill tool fires — any skill invocation.
**Provenance:** 0x2 AGENT.
**Signal:** Confidence the skill is the right choice for this task.
**Payload:**

```json
{
  "skill": "brainstorming",
  "colloquy_mode": "explicit",
  "nested_from_skill": "superpowers:writing-plans"
}
```

**Emitted by:** Instrumented.

### `model_route`

**Fires:** When a router switches the serving model (e.g., haiku→sonnet
because the task escalated in complexity).
**Provenance:** 0x2 AGENT.
**Signal:** Confidence that the escalation was warranted (post-switch).
**Payload:**

```json
{
  "from_model": "claude-haiku-4-5",
  "to_model": "claude-sonnet-4-5",
  "reason": "prior_confidence_below_threshold",
  "threshold_hit": 0.4
}
```

**Emitted by:** Instrumented + agent explicit (for semantic reasons).

### `plan_branch`

**Fires:** At any multi-option decision point where the agent picks among
≥2 alternatives.
**Provenance:** 0x2 AGENT.
**Signal:** Confidence in the chosen option at selection time.
**Payload:**

```json
{
  "options": ["A: rewrite from scratch", "B: incremental refactor", "C: feature flag"],
  "chosen": 1,
  "why": "incremental preserves tests and ships today"
}
```

**Emitted by:** Agent explicit. Cannot be auto-instrumented — the
decision happens inside the LLM.

### `confidence_shift`

**Fires:** When the agent's stated confidence about a claim changes by
more than `signal_shift_threshold` (default 0.2 = 13108 / 65535).
**Provenance:** 0x2 AGENT.
**Signal:** NEW confidence after the shift.
**Payload:**

```json
{
  "claim": "poly markets are read-only",
  "prior_signal": 26214,           // 0x6666 = 40%
  "delta": 39321,                  // +0.6
  "trigger": "saw confirming evidence in FINDINGS.md Phase 4"
}
```

**Emitted by:** Agent explicit.

### `memory_write`

**Fires:** When a fact is persisted to long-term memory (memory_store,
codebook mutation, Obsidian write).
**Provenance:** 0x2 AGENT or 0x1 HUMAN.
**Signal:** Confidence the fact will still be useful 30 days out.
**Payload:**

```json
{
  "target_uuid": "fact_uuid_just_minted",
  "type_code": "0x006",
  "destination": "codebook | memory.md | vault",
  "mutation_kind": "insert | update | retract"
}
```

**Emitted by:** Instrumented (hooks into memory_store) + agent explicit.

### `delegation`

**Fires:** When a subagent is dispatched (Agent tool call).
**Provenance:** 0x2 AGENT (dispatcher).
**Signal:** Confidence the subagent will succeed on its task.
**Payload:**

```json
{
  "subagent_id": "agent-uuid-or-description",
  "task": "first 200 chars of dispatch prompt",
  "isolation": "worktree | inline",
  "expected_return": "summary | artifact | both"
}
```

**Emitted by:** Instrumented (hooks into Agent tool).

### `assertion`

**Fires:** When a previously-tentative claim is promoted to high
confidence (signal ≥ 0xC000, ~75%).
**Provenance:** 0x2 AGENT.
**Signal:** The post-promotion confidence.
**Payload:**

```json
{
  "claim": "cache economics yield 6.35x ROI over 20 turns",
  "evidence": ["computed arithmetic turn 6", "matches Anthropic docs"],
  "prior_signal": 32768
}
```

**Emitted by:** Agent explicit.

### `retraction`

**Fires:** When a previously-held belief is abandoned (signal drops below
0x4000, ~25%, AND was previously ≥ 0x8000).
**Provenance:** 0x2 AGENT.
**Signal:** Post-retraction confidence (low).
**Payload:**

```json
{
  "claim": "we need a salt in the derivation function",
  "reason": "colloquy_uuid's own random field is cryptographically sufficient",
  "prior_signal": 47185,
  "replaced_with_uuid": "new_belief_heartbeat_uuid"
}
```

**Emitted by:** Agent explicit. **Retractions are preserved, not deleted** —
they're first-class learning evidence.

### `uuid_mint`

**Fires:** When any GYST UUID is minted (forecast, contract, fact, etc.).
**Provenance:** Matches the minted entity's provenance.
**Signal:** The new entity's signal field value.
**Payload:**

```json
{
  "type_code": "0x322",
  "type_name": "AERO_FORECAST",
  "uuid": "the full minted UUID",
  "registry_table": "predictions | uuid_registry | facts"
}
```

**Emitted by:** Instrumented (hooks into encodeGYST).

### `keepalive`

**Fires:** When no other heartbeat has fired in `keepalive_ms` ms OR
`keepalive_tokens` tokens of output have passed — whichever comes first.
**Provenance:** Matches the turn's speaker.
**Signal:** Current held confidence (inherited from most recent non-keepalive).
**Payload:**

```json
{
  "trigger": "keepalive_ms | keepalive_tokens",
  "since_last_beat_ms": 31200,
  "since_last_beat_tokens": 2100
}
```

**Emitted by:** Daemon (on timer).

## Reserved / Future

- `tool_result` — post-tool-call, with outcome classification (success/error/empty).
- `validation` — internal consistency check (plan-vs-spec reviewer).
- `escalation` — agent explicitly escalates to human.
- `parallel_merge` — multiple subagent branches merge back to main.

These will be added in future codebook versions as the instrumentation
matures. Do NOT use these kinds yet — emit as `payload_json.reserved_for`
if you need them experimentally.

## Emitter Guidance

| Kind | Instrumented (auto) | Agent explicit |
|---|:---:|:---:|
| `tool_call` | ✅ | — |
| `skill_invoke` | ✅ | — |
| `uuid_mint` | ✅ | — |
| `delegation` | ✅ | — |
| `keepalive` | ✅ (daemon) | — |
| `memory_write` | ✅ partial | ✅ for semantic context |
| `model_route` | ✅ partial | ✅ for reasoning |
| `plan_branch` | — | ✅ required |
| `confidence_shift` | — | ✅ required |
| `assertion` | — | ✅ required |
| `retraction` | — | ✅ required |

**Rule of thumb:** mechanical kinds are auto-emitted; semantic kinds
require the agent to volunteer them. Agent runtimes should be trained
to emit `plan_branch`, `confidence_shift`, `assertion`, `retraction` as
deliberately as they emit tool calls.

## Querying Heartbeats

### All decisions in a colloquy

```sql
SELECT * FROM heartbeats
WHERE colloquy_uuid = ? AND event_kind IN ('plan_branch', 'confidence_shift', 'assertion', 'retraction')
ORDER BY emitted_at;
```

### Confidence trajectory within a turn

```sql
SELECT sequence_in_turn, event_kind, event_label,
       CAST(signal AS REAL) / 65535.0 AS confidence
FROM heartbeats
WHERE turn_uuid = ?
ORDER BY sequence_in_turn;
```

### Agents thrashing (escalations triggered by low confidence)

```sql
SELECT DISTINCT h1.colloquy_uuid, c.skill_name
FROM heartbeats h1
JOIN heartbeats h2 ON h1.turn_uuid = h2.turn_uuid
  AND h2.emitted_at BETWEEN h1.emitted_at - 2000 AND h1.emitted_at + 2000
JOIN colloquies c ON c.colloquy_uuid = h1.colloquy_uuid
WHERE h1.event_kind = 'model_route'
  AND h2.event_kind = 'confidence_shift'
  AND CAST(json_extract(h2.payload_json, '$.delta') AS REAL) > 0.3;
```

### Dead-branch corpus (fine-tuning signal)

```sql
SELECT colloquy_uuid, turn_uuid, event_label,
       json_extract(payload_json, '$.claim') AS abandoned_claim,
       json_extract(payload_json, '$.reason') AS reason
FROM heartbeats
WHERE event_kind = 'retraction'
ORDER BY emitted_at DESC;
```

---

## v0.0.2 Event Kinds

Four additions, bringing the registry total to **15**. All four support
the witness-as-parent / agent-birth-ritual model introduced in colloquy
v0.0.2 (see `references/agent-lifecycle.md` §2 and `codebook-patch-v0.0.2.md`).

### `agent_birth`

**Fires:** Exactly once when a new agent completes the three birth
obligations (UUID mint, registry write, codebook pin) and is ready to
emit heartbeats under its own session.
**Provenance:** 0x2 AGENT (the parent's session emits this on behalf of
the freshly-minted child).
**Signal:** Parent's confidence in the directive and the chosen model.
0xFFFF for fully-specified directives; lower for speculative spawns.
**Payload:**

```json
{
  "child_agent_uuid": "00294f92-…",
  "child_session_uuid": "00a14f92-…",
  "directive_uuid": "00c8a492-…",
  "directive_json": { "task_type_code": 802, "scope": {…}, "witness_policy": "parent_required" },
  "codebook_version_at_birth": "2.5.0",
  "spawn_depth": 3,
  "model_id": "claude-haiku-4-5",
  "role": "aero-forecaster"
}
```

**Emitted by:** Instrumented (spawn-agent.mjs via skill, vcmd, or
PreToolUse hook on `Agent`). If `directive_uuid` is present,
`directive_json` may be omitted (reusable directive referenced by UUID).
Exactly one of the two must be present.

### `witness_signoff`

**Fires:** When the parent agent_session confirms a child's terminal
heartbeat (`assertion`, `uuid_mint`, `memory_write`). This is the
mechanism that turns the heartbeat DAG into a walkable trust chain.
**Provenance:** 0x2 AGENT for intra-machine; 0x2 AGENT with Ed25519
signature in payload for cross-machine (SPOCTALK boundary).
**Signal:** Witness's confidence in the signed-off claim. May be lower
than the child's self-reported signal if the parent is qualifying.
**Payload:**

```json
{
  "witnessed_heartbeat_uuid": "825f9e92-…",
  "witnessed_by_session_uuid": "00a27092-…",
  "approved_type_code": 802,
  "note": "Output matches directive task_type_code; within budget.",
  "signature_ed25519": "…"
}
```

`signature_ed25519` is REQUIRED when the witness session's machine
differs from the witnessed heartbeat's emitting machine; OMITTED
intra-machine (PK+FK graph integrity is the proof). The column
`heartbeats.witnesses_heartbeat_uuid` mirrors
`payload.witnessed_heartbeat_uuid` for cheap SQL joins.
**Emitted by:** Agent explicit — the parent chooses to sign. A colloquy
cannot CLOSE while any terminal claim lacks an ancestor signoff chain
reaching its root (enforced by the `unsigned_terminal_claims` view).

### `witness_refusal`

**Fires:** When the parent rejects a child's claim. A rejected claim is
NOT deleted — it stays in the tree with its refusal heartbeat attached,
forming part of the "things agents almost did wrong" learning corpus.
**Provenance:** 0x2 AGENT (with Ed25519 cross-machine).
**Signal:** Witness's confidence in the REFUSAL (high = firm rejection,
low = uncertain-but-not-endorsing → may imply a subsequent `witness_deferred`).
**Payload:**

```json
{
  "refused_heartbeat_uuid": "825fbcd1-…",
  "witnessed_by_session_uuid": "00a27092-…",
  "reason": "directive_violation|quality|scope|out_of_budget|integrity",
  "retry_allowed": true,
  "retry_directive_delta": { "max_spawn_depth": 5 }
}
```

**Emitted by:** Agent explicit. A refusal on a non-terminal heartbeat is
advisory (child should pivot); a refusal on a terminal heartbeat marks
the subtree as dead and prevents the claim from reaching CLOSED without
a human `witness_deferred`.

### `witness_deferred`

**Fires:** When the parent cannot or will not witness and escalates
judgment upward — typically to a human operator or to a peer agent in a
higher-authority domain.
**Provenance:** 0x2 AGENT (with Ed25519 cross-machine if escalating past
the local machine).
**Signal:** Parent's uncertainty that drove the escalation (low signal
= parent unsure, high signal = parent certain escalation is the right
call).
**Payload:**

```json
{
  "deferred_heartbeat_uuid": "825fbcd1-…",
  "escalation_target_session_uuid": "00a2d0d0-…",
  "reason": "ambiguous_directive|out_of_scope|requires_human_judgment|security",
  "timeout_s": 3600
}
```

**Emitted by:** Agent explicit. The target session MUST subsequently
emit either `witness_signoff` or `witness_refusal` on the
`deferred_heartbeat_uuid` for the chain to complete. If `timeout_s`
elapses without resolution, the colloquy enters `PROMOTING?` state
requiring human intervention.

---

## Registry size and governance

As of v0.0.2 the canonical registry is **15 event_kinds**. Extending
further requires a codebook version bump per the same rule applied to
type codes. The rationale is stability: instrumentation code, audit
queries, and fine-tuning datasets all pin against a known kind set, and
silent extension would make historical colloquies ambiguous to replay.

If you find yourself wanting a new kind, first check whether the need
fits in `payload_json` of an existing kind (most do). Only propose a
new kind when the semantic shape genuinely differs — i.e., when audit
queries would need to distinguish it categorically, not by payload
inspection.
