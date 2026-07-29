<!-- =============================================================================== file_id: SOM-DOC-3766-v1.0.0 name: codebook-patch.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

<!-- =============================================================================== file_id: SOM-DOC-3766-v1.0.0 name: codebook-patch.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

---
file_id: SOM-DOC-0050-v0.1.0
name: codebook-patch.md
description: Codebook §12-§15 additions for the colloquy skill. To be
  applied to app/api/lib/codebook.ts (bumping v2.2.0 → v2.4.0) and
  re-seeded via mini/openclaw/seed-codebook.mjs.
category: DOC
tags: [codebook, patch, colloquy, v2.4.0]
created: 2026-04-22
modified: 2026-04-22
version: 0.1.0
agent_id: claude-sonnet-4-5
---

# Codebook Patch — v2.2.0 → v2.4.0

**Bump rationale:** Adds four new sections (§12 Colloquy, §13 Heartbeat
Taxonomy, §14 Telemetry Modes, §15 Decision Tree) plus four new type
code reservations (`0x009`, `0x00A`, `0x823`, `0x825`). This is a minor
(not major) bump because nothing existing changes semantically — it's
pure addition. Going to v2.4.0 (not v2.3.0) because each section alone
would merit a minor; bundled they warrant the jump.

**Estimated token delta:** +4200 (∼8 KB). New total ≈ 6230 tok.

## Apply

1. Edit `app/api/lib/codebook.ts`:
   - Set `CODEBOOK_VERSION = '2.4.0'`
   - Set `CODEBOOK_ESTIMATED_TOKENS = 6230`
   - Add type registry entries in §3 (see below)
   - Append §12-§15 verbatim (see below)
2. Backup before edit: `cp codebook.ts codebook.ts.bk3`
3. Re-seed Mini Turso: `node mini/openclaw/seed-codebook.mjs`
   (this mints a new `vertex-v{N+1}` codebook_versions row)
4. Reload agent context: `vcmd reload` or restart daemon

## §3 Type Registry — additions

Insert alphabetically within existing `GYST_TYPES` block:

```typescript
// Core extensions (add under 0x00X block):
{ code: 0x009, name: 'COLLOQUY',          desc: 'Sustained multi-turn session; shared Schelling point between parties' },
{ code: 0x00A, name: 'AGENT_SESSION',     desc: 'Per-party projection of a colloquy; derived deterministically from (agent_uuid, colloquy_uuid)' },

// Openclaw block (under 0x82X):
{ code: 0x822, name: 'MEMORY_MUTATION',   desc: 'Audit entry for any change to persistent memory (facts, codebook, vault)' },
{ code: 0x823, name: 'SCRATCH_OBJECT',    desc: 'Ephemeral KV scoped to a colloquy; auto-GC after idle grace' },
{ code: 0x825, name: 'HEARTBEAT',         desc: 'Decision/action event within a turn; forms DAG via parent_heartbeat_uuid' },
```

## §12 COLLOQUY — verbatim

```markdown
## 12. COLLOQUY — sustained multi-turn sessions as first-class artifacts

A **colloquy** is a sustained conversation between 2+ parties (agent↔agent
or human↔agent) minted as a `0x009` UUID at invocation. It keeps the
Anthropic ephemeral prefix cache warm (5-min TTL), so a 20-turn
colloquy costs ~15.75% of the uncached equivalent — a 6.35× savings at
our current 6145-token codebook prefix.

### Topology

Every colloquy has three UUID layers, all self-addressing:

1. **`0x009 COLLOQUY`** — the session itself, shared by all parties.
   Minted by initiator; all parties adopt it. Namespace = fnv1a12(initiator).

2. **`0x00A AGENT_SESSION` per party** — deterministically derived from
   `(agent_uuid, colloquy_uuid)`. Each party can recompute their own and
   any peer's session UUID without DB access. Depth=1, child of colloquy.

3. **`0x005 TURN` per turn** — minted server-side with fresh randomness.
   Depth=2, child of agent_session.

### Invocation modes

- **Implicit:** auto-promote at turn 2 of an unthreaded chat < 30min gap
- **Inherited:** continue existing colloquy via `--colloquy <uuid>`
- **Explicit:** mint at turn 1 via `--new-colloquy <skill>` (preferred for
  declared multi-turn skills)

### Storage split

- **Turso** owns metadata: `colloquies`, `agent_sessions`, `turns`,
  `heartbeats`, `scratch_objects`, `colloquy_forks`.
- **Obsidian vault** owns content: `~/vertex-vault/colloquies/YYYY-MM-DD-<skill>-<uuid_prefix>.md`
  with Ghost Catalog header, per-turn blocks with `^turn-NNN` anchors,
  auto-generated Mermaid decision tree.
- Neither is single-point-of-failure — the colloquy survives either
  one dying. Turso can be rebuilt from vault frontmatter; vault content
  is irreplaceable but git-versioned.

### Skill declaration

Any skill can declare itself as colloquy-shaped:

```yaml
colloquy: true
telemetry:
  mode: heartbeat
```

The runtime then auto-explicit-mints on skill invocation rather than
waiting for turn-2 auto-promotion.

### Lifecycle

MINT → ACTIVE (accepting turns + heartbeats + scratch ops) → IDLE (no
turns in `auto_close_idle_s`) → CLOSING → PROMOTING? → CLOSED.

Closed colloquies are immutable. Fork them instead of editing.
```

## §13 HEARTBEAT TAXONOMY — verbatim

```markdown
## 13. HEARTBEAT TAXONOMY — the decision vocabulary

Heartbeats (`0x825`) are emitted at semantic decision/action points
within a colloquy. Each heartbeat is a self-addressing UUID with its
live confidence encoded in the `signal(16)` bit field, its position in
the decision tree encoded in `depth(4)` and `generation(4)` (fork
index), and kind-specific payload in a JSON column.

### Canonical event_kinds

| kind | fires when | emitter |
|---|---|---|
| `tool_call` | Before any tool invocation | instrumented |
| `skill_invoke` | Skill tool fires | instrumented |
| `model_route` | Router switches model (haiku→sonnet) | both |
| `plan_branch` | Agent picks among ≥2 alternatives | agent explicit |
| `confidence_shift` | Signal delta ≥ threshold (default 0.2) | agent explicit |
| `memory_write` | Persistence action (memory_store, vault write) | both |
| `delegation` | Subagent dispatched | instrumented |
| `assertion` | Claim promoted to ≥0xC000 confidence | agent explicit |
| `retraction` | Belief abandoned (was ≥0x8000, now <0x4000) | agent explicit |
| `uuid_mint` | New GYST UUID minted | instrumented |
| `keepalive` | No event in `keepalive_ms` ms / `keepalive_tokens` tok | daemon |

Extensible but registry-governed — new kinds require codebook bump.

### Retractions are preserved

Dead branches are never deleted. They are first-class learning
evidence: the corpus of "things agents almost did wrong" is gold for
both audit and fine-tuning.

### DAG linkage

Each heartbeat has `parent_heartbeat_uuid`. Recursive CTEs walk the
tree from any leaf back to root, producing the causal ancestry of any
decision. This is the explainability query: "why did you mint this?"
returns the actual reasoning chain, not an LLM's post-hoc narration.
```

## §14 TELEMETRY MODES — verbatim

```markdown
## 14. TELEMETRY MODES — configurable detail per colloquy

Four modes, selected via SKILL.md frontmatter or `--telemetry` flag:

- **`minimal`** — colloquy totals only. Auto-promoted trivial chats.
- **`per_turn`** — turn rows + totals. No heartbeats. Linear skills.
- **`heartbeat`** ⭐ — turn rows + selective heartbeats. **Default for
  colloquy-declared skills.** Recommended for agent loops.
- **`audit`** — heartbeat + per-tool-call (0x811) + full instrumentation.
  Compliance, cost debugging, regulated work.

### Configuration

```yaml
telemetry:
  mode: heartbeat
  heartbeat_kinds: [tool_call, plan_branch, confidence_shift, assertion]
  keepalive_ms: 30000
  keepalive_tokens: 2000
  signal_shift_threshold: 0.2
  emit_inline_in_vault: true
```

### Storage cost

A 10-turn heartbeat-mode colloquy: ~46 rows, ~35 KB. Even 1000 such
colloquies is 35 MB in Turso — negligible. Vault .md is the dominant
cost, same regardless of mode.

### Cache economics validation

`cache_hit_ratio` on the colloquy rollup should trend toward
`prefix_tokens / (prefix_tokens + avg_marginal_input)`. If observed <<
expected, something upstream is busted — query finds it in minutes.
```

## §15 DECISION TREE — verbatim

```markdown
## 15. DECISION TREE — heartbeats form a walkable DAG

Because every heartbeat has `parent_heartbeat_uuid`, a colloquy's
heartbeats form a DAG you can walk, fork, and replay.

### Tree coordinates + live telemetry in UUID bits

The heartbeat UUID's `depth(4)` carries tree depth. `generation(4)`
carries the **scheme version** for the tail 42 bits (0=entropy,
1=packed telemetry). Under scheme_v=1 the last 42 bits decompose as
`tokens_q(16) | savings_q(10) | rand(16)` — accumulated tokens and live
cache-hit ratio readable without a DB lookup. Row columns
`tokens_accumulated` + `cache_hit_ratio_snapshot` remain the truth;
UUID bits are the fast read. Fork index lives in `payload_json`.

### Six first-class operations

1. **Replay** — `SELECT * FROM heartbeats WHERE colloquy_uuid=? ORDER BY emitted_at`
2. **Explain "why?"** — recursive CTE from target heartbeat to root,
   returns causal ancestry (not LLM narration — actual trajectory).
3. **Counterfactual fork** — `/v1/colloquy/fork {from_heartbeat}`
   spawns child colloquy rooted at that decision with alternate context.
4. **Dead-branch audit** — `WHERE event_kind='retraction'` is the
   "things agents almost did wrong" corpus.
5. **Pattern mining** — graph-isomorphism on event_kind sequences
   detects recurring archetypes (Confident Executor, Cautious Explorer,
   Thrasher, Promoted Skeptic).
6. **Mermaid rendering** — auto-appended to vault .md, rendered inline
   in Obsidian. LCARS live viewer at `/vertex/colloquy/[uuid]/tree`.

### The payoff

A colloquy is not a transcript — it's a queryable causal graph with
cryptographic provenance, replayable, forkable, auditable, and
pattern-mineable. That is what it means for identity to be
infrastructure: every conversation becomes first-class data, addressed
and typed down to the individual decision.
```

## Post-apply checklist

- [ ] Verify `CODEBOOK_VERSION === '2.4.0'`
- [ ] Verify `CODEBOOK_ESTIMATED_TOKENS ≈ 6230` (actual measure via tiktoken)
- [ ] Re-render `/vertex/codebook` — confirm new sections display
- [ ] Re-seed Mini: `node mini/openclaw/seed-codebook.mjs` → creates `vertex-v3` (or next)
- [ ] Restart openclaw daemon to reload codebook blob
- [ ] Ping Vertex: `vcmd chat "what sections does codebook v2.4.0 add?"` — should enumerate §12-§15
