<!-- =============================================================================== file_id: SOM-DOC-9001-v1.0.0 name: telemetry-modes.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

<!-- =============================================================================== file_id: SOM-DOC-9001-v1.0.0 name: telemetry-modes.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

---
file_id: SOM-DOC-0047-v0.1.0
name: telemetry-modes.md
description: Colloquy telemetry mode reference. When to use minimal vs
  per_turn vs heartbeat vs audit, how to configure, storage cost analysis.
category: DOC
tags: [colloquy, telemetry, modes, cost]
created: 2026-04-22
modified: 2026-04-22
version: 0.1.0
agent_id: claude-sonnet-4-5
---

# Telemetry Modes

## The Four Modes

| Mode | Per-turn rows | Heartbeats | Rows/10-turn | Use case |
|------|:---:|:---:|:---:|---|
| `minimal` | ❌ | ❌ | ~1 | Auto-promoted trivial chats |
| `per_turn` | ✅ | ❌ | ~10 | Declared skills with no agent-loop complexity |
| **`heartbeat`** ⭐ | ✅ | ✅ selective | ~30-80 | **Default for colloquy-declared skills** |
| `audit` | ✅ | ✅ all kinds + per-tool | ~200+ | Compliance, cost debugging, regulated work |

## When To Pick Which

### `minimal`

Only for auto-promoted colloquies from implicit chats that turned out to
span 2+ turns. You can query colloquy-level totals but you cannot walk
per-turn or per-decision detail.

**Picks it:** The runtime itself (never declared explicitly by a skill).
Upgrades to `per_turn` if turn count exceeds 5.

### `per_turn`

When the skill knows turn metadata matters but there's no meaningful
decision tree to walk (e.g., a straightforward 3-turn design-review where
the agent reads, comments, commits).

**Picks it:** Skills where the turns themselves are the units of analysis
and inner decisions are uninteresting.

Skills like:
- `writing-plans` (sequential plan steps)
- `commit-review` (linear review pass)

### `heartbeat` (recommended default)

When the skill involves agent reasoning, tool use, plan branches, or
model routing — which is most sustained agent work. Gives you the
queryable DAG without the audit-level overhead.

**Picks it:** Nearly every colloquy-declared skill.

Skills like:
- `brainstorming`
- `pair-debug`
- `phd-training`
- `subagent-driven-development`
- `executing-plans`
- Dexter forecast loops
- Anything with multiple tool calls per turn

### `audit`

When you need a complete reconstruction of what happened — typically for
one of:
1. **Cost disputes** — "why did this colloquy cost $3?" — need per-tool-
   call attribution.
2. **Regulated work** — financial forecasts, medical, legal — where full
   reasoning provenance is required.
3. **Debugging token drift** — when cache_hit_ratio is unexpectedly low.

**Picks it:** Opt-in. Never the default.

## Configuration

### SKILL.md frontmatter

```yaml
---
name: phd-training
colloquy: true
telemetry:
  mode: heartbeat                    # minimal | per_turn | heartbeat | audit
  heartbeat_kinds:                   # optional whitelist; omit = all
    - tool_call
    - skill_invoke
    - model_route
    - confidence_shift
    - plan_branch
    - assertion
    - retraction
    - memory_write
  keepalive_ms: 30000                # fallback keepalive if no event in N ms
  keepalive_tokens: 2000             # fallback if N tokens without event
  signal_shift_threshold: 0.2        # min delta to fire confidence_shift (0.0-1.0)
  emit_inline_in_vault: true         # also append stats line to vault .md turn block
  capture_tool_calls: false          # audit-only: write 0x811 rows per tool
---
```

### Per-invocation override

```bash
# Upgrade mode for this colloquy only
vcmd chat --new-colloquy brainstorming --telemetry=audit "..."

# Downgrade for a quick test
vcmd chat --telemetry=minimal "one-shot test..."

# Tune keepalive
vcmd chat --new-colloquy dexter-loop --keepalive-ms=5000 --keepalive-tokens=500 "..."
```

### Runtime API override

```
POST /v1/colloquy/mint {
  skill: "pair-debug",
  parties: [...],
  telemetry: {
    mode: "heartbeat",
    heartbeat_kinds: ["tool_call", "plan_branch", "confidence_shift"],
    keepalive_ms: 15000
  }
}
```

## Storage Cost Analysis

Assumptions: 10-turn colloquy, 500 input tok / 1500 output tok per turn,
3 tool calls per turn, 1 model_route per colloquy, 4 confidence_shifts.

| Mode | colloquies rows | turns rows | heartbeats rows | scratch rows | Total rows | Bytes (approx) |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| `minimal` | 1 | 0 | 0 | 0-3 | 1-4 | ~1 KB |
| `per_turn` | 1 | 10 | 0 | 0-3 | 11-14 | ~8 KB |
| `heartbeat` | 1 | 10 | ~35 | 0-3 | 46-49 | ~35 KB |
| `audit` | 1 | 10 | ~50 | 0-3 | 61-64 | ~70 KB (with 0x811 rows) |

**Per-colloquy Turso storage is negligible at any mode.** Even 1000
audit-mode colloquies = ~70 MB.

Cost is dominated by the vault `.md` file, which is the same size
regardless of telemetry mode (content is content).

## Mermaid Decision Tree (Heartbeat Mode Only)

When `mode: heartbeat`, the vault `.md` gets an auto-generated Mermaid
decision tree appended as each turn closes. See `decision-tree.md` for
full spec.

Rendering happens client-side in Obsidian — no storage cost.

## Cost Audit Queries

### Total $ spent on a colloquy

```sql
SELECT colloquy_uuid, skill_name,
       total_cost_usd_micro / 1000000.0 AS usd,
       turn_count,
       (total_cost_usd_micro / 1000000.0) / turn_count AS usd_per_turn
FROM colloquies
WHERE colloquy_uuid = ?;
```

### Per-skill average cost

```sql
SELECT skill_name,
       COUNT(*) AS sessions,
       AVG(total_cost_usd_micro / 1000000.0) AS avg_usd,
       AVG(turn_count) AS avg_turns,
       AVG(cache_hit_ratio) AS avg_cache_hit
FROM colloquies
WHERE ended_at IS NOT NULL
GROUP BY skill_name
ORDER BY avg_usd DESC;
```

### Cache economics validation

Expected: `cache_hit_ratio ≈ prefix_tokens / (prefix_tokens + avg_marginal_input_per_turn)`.
If observed << expected, cache isn't warming properly.

```sql
SELECT colloquy_uuid,
       prefix_tokens,
       total_input_tokens / turn_count AS avg_input_per_turn,
       cache_hit_ratio,
       prefix_tokens * 1.0 / (prefix_tokens + (total_input_tokens - prefix_tokens) / turn_count) AS expected_ratio
FROM colloquies
WHERE turn_count >= 3
  AND cache_hit_ratio < prefix_tokens * 0.8 / (prefix_tokens + (total_input_tokens - prefix_tokens) / turn_count);
```

Any row returned is a colloquy with sub-par cache performance — worth investigating.
