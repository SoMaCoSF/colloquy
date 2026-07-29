<!-- =============================================================================== file_id: SOM-DOC-1107-v1.0.0 name: derivation.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

<!-- =============================================================================== file_id: SOM-DOC-1107-v1.0.0 name: derivation.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

---
file_id: SOM-DOC-0045-v0.1.0
name: derivation.md
description: UUID derivation formulas for colloquy, agent_session, turn, and
  heartbeat UUIDs. Includes collision analysis, reproducibility proofs, and
  scheme versioning.
category: DOC
tags: [colloquy, gyst, derivation, uuidv8, collision-analysis]
created: 2026-04-22
modified: 2026-04-22
version: 0.1.0
agent_id: claude-sonnet-4-5
---

# Colloquy UUID Derivation — Spec

## Design Invariants

1. **Determinism.** Given the same inputs, any party computes the same UUID.
2. **Offline provability.** A party can verify another party's session UUID
   without DB access, given the shared inputs.
3. **Collision safety.** Two simultaneous mints with differing inputs produce
   distinct UUIDs with negligible (< 2^-42) collision probability.
4. **Scheme versioning.** If we ever change a derivation function, old UUIDs
   remain reproducible because the version is encoded in the bits.

## Bit Layout Reminder

128 bits total, MSB → LSB:

```
[ type      12 ][ namespace 12 ][ timestamp 24 ][ version 4 ]
[ depth      4 ][ domain     4 ][ generation 4 ][ variant 2 ]
[ provenance 4 ][ signal    16 ][ random    42 ]
```

## 1. Colloquy UUID (0x009)

Minted by the initiator (first speaker). All other parties adopt this UUID
from the first message they receive in the session.

```ts
function mintColloquyUUID(initiator_agent: Agent, opts?: { nonce?: string }): string {
  const now_s = Math.floor(Date.now() / 1000) - EPOCH_2026;
  const nonce = opts?.nonce ?? randomBytes(16).toString('hex');
  const seed = `colloquy|${initiator_agent.uuid}|${now_s}|${nonce}`;
  return encodeGYST({
    type: 0x009,
    namespace: fnv1a12(initiator_agent.uuid),
    timestamp: now_s,
    version: 0x8,
    depth: 0x0,                                 // root
    domain: initiator_agent.domain,
    generation: SCHEME_VERSION_v1,              // 0x0 for v1
    variant: 0b10,
    provenance: initiator_agent.provenance,
    signal: 0xFFFF,                             // deterministic mint
    random: sha256(seed).readBigUInt64BE(0) & ((1n << 42n) - 1n),
  });
}
```

**Why namespace = fnv1a12(initiator_uuid):** enables reverse lookup of the
initiator from the colloquy UUID alone, given a readable agent registry.
This is intentional disclosure (Prime Directive).

**Why random = sha256 of seed:** makes the mint reproducible if the
initiator records the nonce. Two parties with the same (initiator, timestamp,
nonce) compute the same UUID.

## 2. Agent Session UUID (0x00A) — Per-Party Derivation

Each party derives their own per-session UUID. No network call needed.

```ts
function deriveAgentSessionUUID(agent: Agent, colloquy_uuid: string): string {
  const colloquy = decodeGYST(colloquy_uuid);
  const seed = `session|${agent.uuid}|${colloquy_uuid}`;
  return encodeGYST({
    type: 0x00A,
    namespace: fnv1a12(agent.uuid),             // points back to agent
    timestamp: colloquy.timestamp,              // shared instant
    version: 0x8,
    depth: 0x1,                                 // child of colloquy
    domain: agent.domain,
    generation: SCHEME_VERSION_v1,              // same scheme as colloquy
    variant: 0b10,
    provenance: 0x2,                            // AGENT (runtime projection)
    signal: 0xFFFF,                             // deterministic
    random: sha256(seed).readBigUInt64BE(0) & ((1n << 42n) - 1n),
  });
}
```

**Key property:** given `(agent.uuid, colloquy_uuid)`, any party can
reconstruct any other party's session UUID. That's how a party *proves*
it was in the colloquy without needing Turso.

**Why no salt:** the colloquy_uuid itself already contains the initiator's
nonce (in its random field), so it's cryptographically sufficient. Adding a
salt would put state in Turso and weaken the math-as-source-of-truth claim.

## 3. Turn UUID (0x005)

Minted by the daemon at the start of each turn. Contentful random — no
derivation needed since turns are strictly sequential.

```ts
function mintTurnUUID(speaker_session_uuid: string, turn_index: number): string {
  return encodeGYST({
    type: 0x005,
    namespace: fnv1a12(speaker_session_uuid),
    timestamp: Math.floor(Date.now() / 1000) - EPOCH_2026,
    version: 0x8,
    depth: 0x2,                                 // grandchild of colloquy
    domain: decodeGYST(speaker_session_uuid).domain,
    generation: turn_index & 0xF,               // lower 4 bits of index
    variant: 0b10,
    provenance: 0x2,
    signal: 0xFFFF,                             // until completion
    random: randomBytes(6).readUIntBE(0, 6) & ((1 << 42) - 1),
  });
}
```

Turn UUIDs are *not* reproducible by peers — they're minted server-side
with fresh randomness. Peers discover turn UUIDs by reading them from
the vault file or Turso.

## 4. Heartbeat UUID (0x825)

Minted at each semantic decision or action. The bit layout itself carries
the tree topology via `depth` and `generation`.

```ts
function mintHeartbeatUUID(opts: {
  turn_uuid: string,
  parent_heartbeat_uuid: string | null,
  event_kind: string,
  event_label: string,
  branch_depth: number,          // depth in decision tree (root=0)
  fork_index: number,            // generation within plan_branch (0..15)
  provenance: number,
  signal: number,
  payload: any,
}): string {
  const turn = decodeGYST(opts.turn_uuid);
  const seed = `heartbeat|${opts.turn_uuid}|${opts.parent_heartbeat_uuid ?? 'root'}|${opts.event_kind}|${opts.event_label}|${Date.now()}`;
  return encodeGYST({
    type: 0x825,
    namespace: fnv1a12(opts.turn_uuid),
    timestamp: Math.floor(Date.now() / 1000) - EPOCH_2026,
    version: 0x8,
    depth: opts.branch_depth & 0xF,             // tree coordinate!
    domain: 0x6,                                // TECH (heartbeats are always technical)
    generation: opts.fork_index & 0xF,          // tree coordinate!
    variant: 0b10,
    provenance: opts.provenance,
    signal: opts.signal,                        // LIVE CONFIDENCE in the bits
    random: sha256(seed).readBigUInt64BE(0) & ((1n << 42n) - 1n),
  });
}
```

**Why `depth` + `generation` carry tree coordinates:** you can *partially
walk* the decision tree from UUIDs alone, without DB access. Given two
heartbeat UUIDs, you can tell their depths, their fork indices at their
depth, and approximately where they diverge — without loading any rows.

**Why `signal` field carries live confidence:** a heartbeat at
`signal=0x9A00` records that *at that moment* the agent held ~60%
confidence. Over the course of a colloquy, signal trajectories reveal
uncertainty cascades, confidence convergence, and epistemic drift.

## 5. Scratch Object UUID (0x823)

```ts
function mintScratchUUID(colloquy_uuid: string, key: string): string {
  return encodeGYST({
    type: 0x823,
    namespace: fnv1a12(colloquy_uuid),
    timestamp: Math.floor(Date.now() / 1000) - EPOCH_2026,
    version: 0x8,
    depth: 0x1,
    domain: 0x6,
    generation: 0x0,
    variant: 0b10,
    provenance: 0x2,
    signal: 0x8000,                             // ephemeral, ~50% "confidence it'll still be useful"
    random: sha256(`scratch|${colloquy_uuid}|${key}`).readBigUInt64BE(0) & ((1n << 42n) - 1n),
  });
}
```

Note: `random` is deterministic from `(colloquy_uuid, key)` — so writing
the same key twice produces the same UUID (idempotent UPSERT).

## Collision Analysis

### Within-second collisions

Two colloquies mint in the same second with different initiators:
- Namespaces differ → different UUIDs. Safe.

Two colloquies mint in the same second with the **same initiator**:
- Namespaces equal, timestamps equal.
- Differentiator is `random(42)` = sha256(seed) where seed includes nonce.
- Collision probability ≈ 2^-42 ≈ 2.3 × 10^-13 per pair.
- At 1000 colloquy mints/second from same initiator: expected collision
  every 10^9 years. Safe.

### Session UUID uniqueness

Within one colloquy, session UUIDs derived from different agents differ in
namespace (fnv1a12(agent_uuid)). Safe.

Same agent joining two colloquies at the same second: different
colloquy_uuid → different seed → different random. Safe.

### Heartbeat UUIDs

Within one turn, heartbeats at the same depth + generation + timestamp
differ in random (sha256 seed includes parent + label + Date.now() ms).
Collision is possible if two heartbeats fire in the same millisecond with
identical parent/kind/label. Probability is 2^-42 per such pair.

Mitigation: SCHEMA `UNIQUE(turn_uuid, sequence_in_turn)`. If a collision
ever occurs, INSERT fails and the caller retries with a fresh timestamp.

## Scheme Versioning

The `generation` field in colloquy and agent_session UUIDs stores the
derivation scheme version:

```
SCHEME_VERSION_v1 = 0x0  // this document
SCHEME_VERSION_v2 = 0x1  // reserved for future
...
```

If the derivation function changes, bump the constant. Old UUIDs remain
reproducible with v1; new UUIDs encode v2. `decodeGYST(uuid).generation`
tells you which scheme to use.

## Reproducibility Proof

Given these public inputs:
- `initiator_agent_uuid`
- `colloquy_timestamp`
- `colloquy_nonce`
- (list of) `party_agent_uuid`

Anyone can deterministically compute:
- `colloquy_uuid` (from inputs 1-3)
- All `agent_session_uuid`s (from colloquy_uuid + each party)
- (Turn UUIDs still require the daemon — they're fresh-random.)

This means: **a colloquy can be cryptographically reconstructed from its
public inputs alone, even if Turso is wiped.** The content of turns lives
in the Obsidian vault (versioned, portable). The only thing lost with
Turso is telemetry rollups — which can be recomputed from raw turn rows
if those are preserved.

## Canonical Implementation

See `scripts/lib/derive.mjs` (shipped with this skill) for a reference
implementation matching this spec exactly. The `encodeGYST` and
`fnv1a12` primitives come from `app/api/lib/gyst-server.ts`.
