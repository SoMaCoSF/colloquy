// =============================================================================
// file_id: SOM-SCR-0025-v0.0.2
// name: spawn-agent.mjs
// description: Atomic birth-ritual CLI for the colloquy v0.0.2 protocol.
//              Performs the four atomic obligations (UUID mint, registry write,
//              birth heartbeat, codebook projection record) in one Turso
//              transaction. Rolls back all on any failure.
// category: SCR
// tags: [colloquy, spawn, birth-ritual, v0.0.2, atomic]
// created: 2026-04-22
// version: 0.0.2
// =============================================================================
//
// Dependency note: imports @libsql/client. Resolution is attempted from the
// parent project's node_modules at D:/somacosf/outputs/somacosf-platform when
// not found in a local tree. If absent, install via `npm i @libsql/client`.
//
// Reference directive JSON shape:
//   {
//     "task_type": "aero-forecast",
//     "task_type_code": 802,
//     "domain": 1,
//     "skill": "aero-forecast",
//     "scope": {
//       "tools": ["poly_scan", "aero_slurp"],
//       "max_spawn_depth": 3,
//       "budget_tokens": 50000
//     },
//     "witness_policy": "parent_required",
//     "deadline_s": 600,
//     "pinned_codebook": "persona-scanner-v1"
//   }
//
// Exit codes:
//   0  success (or selftest / dry-run pass)
//   1  unknown failure
//   2  CLI / directive parse failure
//   3  parent agent not found
//   4  codebook persona not found
//   5  spawn_depth ceiling exceeded
//   10 DB error during transaction (rolled back)
// =============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve as pathResolve, dirname } from 'node:path';

import {
  encodeGYST,
  decodeGYST,
  fnv1a12,
  mintHeartbeatUUID,
  EPOCH_2026,
  SCHEME_VERSION_v1,
} from './lib/derive.mjs';

import { provisionMicroVM, recordSandbox } from './firecracker-provision.mjs';
import { spawnSync as _spawnSync } from 'node:child_process';
import { existsSync as _existsSync } from 'node:fs';
import path from 'node:path';
import { homedir as _homedir } from 'node:os';

// ---- vault scaffolder resolver (post-birth hook; non-fatal) ------------------
function _resolveVaultScaffold() {
  const cands = [
    `${_homedir()}/openclaw/skills/colloquy/scripts/vault-scaffold.mjs`,
    `${_homedir()}/.claude/skills/colloquy/scripts/vault-scaffold.mjs`,
    'D:/somacosf/.claude/skills/colloquy/scripts/vault-scaffold.mjs',
  ];
  return cands.find(p => _existsSync(p));
}
const _VAULT_SCAFFOLD = _resolveVaultScaffold();

// ---------------------------------------------------------------------------
// Local derivations required by the birth ritual but not yet in derive.mjs
// ---------------------------------------------------------------------------

/**
 * Deterministic hash of the canonical directive JSON. Stable across runs for
 * the same logical directive — keys are sorted before serialization.
 */
export function hashDirective(directive) {
  const canon = canonicalizeJSON(directive);
  return createHash('sha256').update(canon).digest('hex');
}

function canonicalizeJSON(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalizeJSON).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalizeJSON(v[k])).join(',') + '}';
}

function sha256_42bits(seed) {
  const buf = createHash('sha256').update(seed).digest();
  const hi = BigInt(buf.readUInt32BE(0));
  const lo = BigInt(buf.readUInt32BE(4));
  const v = (hi << 32n) | lo;
  return v & ((1n << 42n) - 1n);
}

/**
 * Mint a child agent UUID (type 0x003 AGENT) deterministically from
 * (parent_agent_uuid, directive_json, spawn_timestamp_ms).
 *
 * Same inputs -> same UUID; enables idempotent retries of a birth.
 */
export function mintAgentUUID({
  parent_agent_uuid,
  directive,
  spawn_timestamp_ms,
  domain,
  provenance,
  spawn_depth,
}) {
  const dir_hash = hashDirective(directive);
  const seed = `agent_birth|${parent_agent_uuid}|${dir_hash}|${spawn_timestamp_ms}`;
  const ts_s = Math.floor(spawn_timestamp_ms / 1000) - EPOCH_2026;
  return encodeGYST({
    type: 0x003,
    namespace: fnv1a12(parent_agent_uuid),
    timestamp: ts_s & 0xFFFFFF,
    version: 0x8,
    depth: (spawn_depth ?? 0) & 0xF,
    domain: domain & 0xF,
    generation: SCHEME_VERSION_v1,
    variant: 0b10,
    provenance: provenance & 0xF,
    signal: 0xFFFF,
    random: sha256_42bits(seed),
  });
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const USAGE = `
Usage:
  node spawn-agent.mjs \\
    --parent-agent-uuid <uuid> \\
    --parent-session-uuid <uuid> \\
    --colloquy-uuid <uuid> \\
    --parent-heartbeat-uuid <uuid> \\
    --directive-json-path <path/to/directive.json> \\
    --codebook-name <name> \\
    --codebook-generation <N> \\
    --witness-policy <parent_required|self_signed_ok|human_escalate> \\
    [--sandbox-tier 3]   (default 3; tiers 1 and 2 reserved for later modules) \\
    [--dry-run] \\
    [--db-url <url>]

Env:
  TURSO_DATABASE_URL  (fallback: file:./colloquy.db)
  TURSO_AUTH_TOKEN    (not required for file://)
`.trim();

function parseArgs(argv) {
  const out = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v == null) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--parent-agent-uuid': out.parentAgentUuid = next(); break;
      case '--parent-session-uuid': out.parentSessionUuid = next(); break;
      case '--colloquy-uuid': out.colloquyUuid = next(); break;
      case '--parent-heartbeat-uuid': out.parentHeartbeatUuid = next(); break;
      case '--directive-json-path': out.directiveJsonPath = next(); break;
      case '--codebook-name': out.codebookName = next(); break;
      case '--codebook-generation': out.codebookGeneration = Number(next()); break;
      case '--witness-policy': out.witnessPolicy = next(); break;
      case '--db-url': out.dbUrl = next(); break;
      case '--sandbox-tier': out.sandboxTier = Number(next()); break;
      case '--dry-run': out.dryRun = true; break;
      case '--help':
      case '-h':
        console.log(USAGE);
        process.exit(0);
      default:
        throw new Error(`unknown arg: ${a}`);
    }
  }
  return out;
}

function requireArgs(args) {
  const required = [
    'parentAgentUuid', 'parentSessionUuid', 'colloquyUuid',
    'parentHeartbeatUuid', 'directiveJsonPath',
    'codebookName', 'codebookGeneration', 'witnessPolicy',
  ];
  const missing = required.filter(k => args[k] == null || args[k] === '');
  if (missing.length) {
    console.error('missing required args: ' + missing.join(', '));
    console.error('\n' + USAGE);
    process.exit(2);
  }
  const validPolicies = ['parent_required', 'self_signed_ok', 'human_escalate'];
  if (!validPolicies.includes(args.witnessPolicy)) {
    console.error(`--witness-policy must be one of ${validPolicies.join('|')}`);
    process.exit(2);
  }
  // v0.0.3: tiers 1 (Docker) and 2 (gVisor) are reserved for later modules.
  // Only Tier 3 (Firecracker microVM) is implemented.
  if (args.sandboxTier == null) args.sandboxTier = 3;
  if (args.sandboxTier !== 3) {
    console.error('only --sandbox-tier 3 is implemented in v0.0.3; tiers 1 and 2 are reserved for later module drops');
    process.exit(2);
  }
}

function loadDirective(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    const dir = JSON.parse(raw);
    if (typeof dir !== 'object' || dir == null) throw new Error('directive not an object');
    for (const k of ['task_type', 'task_type_code', 'domain', 'skill', 'scope']) {
      if (!(k in dir)) throw new Error(`directive missing field: ${k}`);
    }
    if (typeof dir.scope !== 'object' || dir.scope == null) {
      throw new Error('directive.scope must be an object');
    }
    return dir;
  } catch (e) {
    console.error(`directive JSON parse error: ${e.message}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// @libsql/client resolution — search local, then parent platform node_modules
// ---------------------------------------------------------------------------

async function loadLibsql() {
  try {
    const mod = await import('@libsql/client');
    return mod.createClient;
  } catch (e) {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      pathResolve(here, '../../../../outputs/somacosf-platform/node_modules/@libsql/client/index.js'),
      pathResolve(here, '../../../../outputs/somacosf-platform/node_modules/@libsql/client/lib-esm/node.js'),
      'D:/somacosf/outputs/somacosf-platform/node_modules/@libsql/client/index.js',
    ];
    for (const c of candidates) {
      if (existsSync(c)) {
        const mod = await import(pathToFileURL(c).href);
        return mod.createClient;
      }
    }
    throw new Error(
      '@libsql/client not resolvable. Install it (`npm i @libsql/client`) ' +
      'or run from a tree that can resolve it.'
    );
  }
}

// ---------------------------------------------------------------------------
// Main birth ritual
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error(e.message);
    console.error('\n' + USAGE);
    process.exit(2);
  }
  requireArgs(args);

  const directive = loadDirective(args.directiveJsonPath);
  const spawn_ts_ms = Date.now();

  // We don't know parent.domain / parent.provenance yet — fetch from parent row.
  // For dry-run without DB, we fall back to directive.domain and provenance=0x2.
  const dbUrl = args.dbUrl ?? process.env.TURSO_DATABASE_URL ?? 'file:./colloquy.db';
  const authToken = process.env.TURSO_AUTH_TOKEN;

  let createClient, client;
  if (!args.dryRun) {
    createClient = await loadLibsql();
    client = createClient({ url: dbUrl, authToken });
  }

  // ----- Step 3: fetch parent -----
  let parentDomain = directive.domain;
  let parentProvenance = 0x2;
  let pDepth = 0;

  if (!args.dryRun) {
    const pRes = await client.execute({
      sql: 'SELECT agent_uuid, domain, provenance, spawn_depth FROM agents WHERE agent_uuid = ?',
      args: [args.parentAgentUuid],
    });
    if (pRes.rows.length === 0) {
      console.error(`parent agent not found: ${args.parentAgentUuid}`);
      process.exit(3);
    }
    const p = pRes.rows[0];
    parentDomain = Number(p.domain);
    parentProvenance = Number(p.provenance);
    pDepth = Number(p.spawn_depth ?? 0);
  } else {
    console.error('[dry-run] skipping parent agent lookup; using directive.domain + provenance=0x2 + spawn_depth=0');
  }

  // ----- Step 4: spawn depth ceiling -----
  const childDepth = pDepth + 1;
  if (childDepth > 15) {
    // TODO: fork-promotion: when spawn_depth would exceed 15, promote the
    //       would-be-child into a fresh colloquy fork instead of refusing.
    console.error('spawn_depth ceiling 15 reached; fork-promotion not yet implemented');
    process.exit(5);
  }

  // ----- Step 5: codebook lookup -----
  let codebook = null;
  if (!args.dryRun) {
    const cRes = await client.execute({
      sql: `SELECT codebook_uuid, face_id, shell, sector, theta, phi, generation
              FROM codebook_personas
             WHERE name = ? AND generation = ?`,
      args: [args.codebookName, args.codebookGeneration],
    });
    if (cRes.rows.length === 0) {
      console.error(`codebook persona not found: name=${args.codebookName} generation=${args.codebookGeneration}`);
      process.exit(4);
    }
    const r = cRes.rows[0];
    codebook = {
      codebook_uuid: String(r.codebook_uuid),
      face_id: Number(r.face_id),
      shell: Number(r.shell),
      sector: Number(r.sector),
      theta: Number(r.theta),
      phi: Number(r.phi),
      generation: Number(r.generation),
    };
  } else {
    codebook = {
      codebook_uuid: '00000000-0000-8000-0000-000000000000',
      face_id: 0, shell: 0, sector: 0, theta: 0.0, phi: 0.0,
      generation: args.codebookGeneration,
    };
    console.error('[dry-run] using placeholder codebook row');
  }

  // ----- Step 6: child UUID -----
  const child_agent_uuid = mintAgentUUID({
    parent_agent_uuid: args.parentAgentUuid,
    directive,
    spawn_timestamp_ms: spawn_ts_ms,
    domain: typeof directive.domain === 'number' ? directive.domain : parentDomain,
    provenance: parentProvenance,
    spawn_depth: childDepth,
  });

  // ----- Step 7: birth heartbeat UUID -----
  // Heartbeats are keyed off turn_uuid; we use the parent_heartbeat_uuid's turn
  // (a birth heartbeat attaches to the turn that emitted the spawn decision).
  // For deterministic chaining we seed with the parent heartbeat UUID itself.
  const birth_heartbeat_uuid = mintHeartbeatUUID({
    turn_uuid: args.parentHeartbeatUuid,        // placeholder for turn-context
    parent_heartbeat_uuid: args.parentHeartbeatUuid,
    event_kind: 'agent_birth',
    event_label: `birth:${directive.skill ?? directive.task_type}`,
    branch_depth: childDepth,
    provenance: parentProvenance,
    signal: 0xE000,
  });

  const directiveJsonStr = JSON.stringify(directive);
  const agentName = directive.skill
    ? `${directive.skill}-${child_agent_uuid.slice(0, 8)}`
    : `agent-${child_agent_uuid.slice(0, 8)}`;

  const agentsInsertSQL = `
    INSERT INTO agents (
      agent_uuid, name, kind, model, provenance, domain, born_at,
      parent_agent_uuid, spawn_depth,
      codebook_version_at_birth, directive_json,
      birth_heartbeat_uuid, birth_colloquy_uuid, witness_policy,
      codebook_uuid, codebook_face_id, codebook_shell,
      codebook_sector, codebook_theta, codebook_phi
    ) VALUES (?, ?, 'agent', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `.trim();
  const agentsInsertArgs = [
    child_agent_uuid, agentName, parentProvenance,
    typeof directive.domain === 'number' ? directive.domain : parentDomain,
    spawn_ts_ms,
    args.parentAgentUuid, childDepth,
    `${args.codebookName}@${args.codebookGeneration}`, directiveJsonStr,
    birth_heartbeat_uuid, args.colloquyUuid, args.witnessPolicy,
    codebook.codebook_uuid, codebook.face_id, codebook.shell,
    codebook.sector, codebook.theta, codebook.phi,
  ];

  // Heartbeat row. sequence_in_turn MUST be unique within the turn; we pick a
  // large sentinel ordering but real usage should derive sequence properly.
  // For the birth heartbeat we use epoch-ms-modulated seq to avoid collisions
  // in most practical cases; tune in caller.
  const seq = Math.floor(spawn_ts_ms % 1_000_000);

  const heartbeatInsertSQL = `
    INSERT INTO heartbeats (
      heartbeat_uuid, turn_uuid, colloquy_uuid, parent_heartbeat_uuid,
      emitted_at, sequence_in_turn, branch_depth, event_kind, event_label,
      tokens_accumulated, cache_hit_ratio_snapshot, scheme_v,
      cache_state, signal, provenance, payload_json,
      witnessed_by_session_uuid, witnessed_type_code, witnesses_heartbeat_uuid,
      codebook_v
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'agent_birth', ?, NULL, NULL, 1,
              NULL, ?, ?, ?, ?, ?, ?, ?)
  `.trim();
  const payload = {
    child_agent_uuid,
    parent_agent_uuid: args.parentAgentUuid,
    directive_hash: hashDirective(directive),
    codebook: { name: args.codebookName, generation: args.codebookGeneration },
    spawn_depth: childDepth,
  };
  const heartbeatInsertArgs = [
    birth_heartbeat_uuid,
    args.parentHeartbeatUuid,            // turn_uuid proxy; TODO resolve real turn
    args.colloquyUuid,
    args.parentHeartbeatUuid,            // parent_heartbeat_uuid
    spawn_ts_ms,
    seq,
    childDepth,
    `birth:${directive.skill ?? directive.task_type}`,
    0xE000,                               // signal
    parentProvenance,
    JSON.stringify(payload),
    args.parentSessionUuid,              // witnessed_by_session_uuid
    0x003,                                // witnessed_type_code = AGENT
    args.parentHeartbeatUuid,            // witnesses_heartbeat_uuid
    `${args.codebookName}@${args.codebookGeneration}`,
  ];

  // ----- Dry-run short-circuit -----
  if (args.dryRun) {
    console.log('=== DRY RUN ===');
    console.log('child_agent_uuid:      ', child_agent_uuid);
    console.log('birth_heartbeat_uuid:  ', birth_heartbeat_uuid);
    console.log('spawn_depth:           ', childDepth);
    console.log('codebook_uuid:         ', codebook.codebook_uuid);
    console.log('sandbox_tier:          ', args.sandboxTier, '(would provision tier=3 stub microVM on this platform)');
    console.log('\n-- SQL (placeholders visually interpolated; NOT executed) --');
    console.log('BEGIN;');
    console.log(interpolate(agentsInsertSQL, agentsInsertArgs) + ';');
    console.log(interpolate(heartbeatInsertSQL, heartbeatInsertArgs) + ';');
    console.log('-- then (outside tx): provisionMicroVM -> UPDATE agents SET sandbox_*, INSERT sandboxes row');
    console.log('COMMIT;');
    process.exit(0);
  }

  // ----- Step 8: atomic transaction -----
  const tx = await client.transaction('write');
  let stage = 'begin';
  try {
    stage = 'agents-insert';
    await tx.execute({ sql: agentsInsertSQL, args: agentsInsertArgs });
    stage = 'heartbeats-insert';
    await tx.execute({ sql: heartbeatInsertSQL, args: heartbeatInsertArgs });
    stage = 'commit';
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch {}
    console.error(`DB transaction failed at stage=${stage}: ${e.message}`);
    process.exit(10);
  }

  // ----- Step 9a: provision Tier-3 microVM (v0.0.3) -----
  // Outside the atomic tx on purpose — birth is the canonical fact; sandbox
  // provision is a follow-on with its own state machine (see sandboxes table).
  // Stub mode on Windows/macOS records an honest 'stub' row.
  let sandbox = null;
  try {
    sandbox = await provisionMicroVM({ agent_uuid: child_agent_uuid });
    await recordSandbox(client, child_agent_uuid, sandbox);
    await client.execute({
      sql: `UPDATE agents
               SET sandbox_tier = ?, sandbox_vm_id = ?, sandbox_rootfs_hash = ?, sandbox_booted_at = ?
             WHERE agent_uuid = ?`,
      args: [
        sandbox.tier, sandbox.vm_id, sandbox.rootfs_hash,
        sandbox.state === 'booted' ? sandbox.booted_at : null,
        child_agent_uuid,
      ],
    });
  } catch (e) {
    // Don't fail the birth on sandbox trouble — log and continue. Agent exists;
    // sandbox_vm_id will be NULL and ops can re-provision.
    console.error(`sandbox provision failed (non-fatal): ${e.message}`);
  }

  // ----- Step 9c: scaffold Obsidian vault (v0.0.3 follow-on) -----
  // Non-fatal. Materializes ~/vaults/<name>/ with birth.md, crosslinks into
  // Vertex's agents/ folder if present. Auto-allocates vector_NN for vectors.
  let vault = null;
  if (_VAULT_SCAFFOLD) {
    try {
      const r = _spawnSync('node', [_VAULT_SCAFFOLD, '--agent-uuid', child_agent_uuid], {
        encoding: 'utf8', env: process.env,
      });
      if (r.status === 0 && r.stdout) {
        try { vault = JSON.parse(r.stdout); } catch { vault = { raw: r.stdout.trim() }; }
      } else if (r.stderr) {
        console.error(`vault scaffold non-fatal: ${r.stderr.trim()}`);
      }
    } catch (e) {
      console.error(`vault scaffold failed (non-fatal): ${e.message}`);
    }
  }

  // ----- Step 9b: machine-readable chaining output -----
  console.log(JSON.stringify({
    child_agent_uuid,
    birth_heartbeat_uuid,
    spawn_depth: childDepth,
    codebook_uuid: codebook.codebook_uuid,
    parent_agent_uuid: args.parentAgentUuid,
    colloquy_uuid: args.colloquyUuid,
    born_at: spawn_ts_ms,
    sandbox: sandbox
      ? { sandbox_uuid: sandbox.sandbox_uuid, tier: sandbox.tier, state: sandbox.state, vm_id: sandbox.vm_id }
      : null,
    vault,
  }, null, 2));
}

// ---------------------------------------------------------------------------
// Placeholder interpolation (visual only; never fed to a DB)
// ---------------------------------------------------------------------------

function interpolate(sql, args) {
  let i = 0;
  return sql.replace(/\?/g, () => {
    const v = args[i++];
    if (v == null) return 'NULL';
    if (typeof v === 'number') return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

// ---------------------------------------------------------------------------
// Selftest
// ---------------------------------------------------------------------------

function selftest() {
  const fakeParent = encodeGYST({
    type: 0x003, namespace: fnv1a12('parent'), timestamp: 0,
    version: 0x8, depth: 0x0, domain: 0x6, generation: 0x1,
    variant: 0b10, provenance: 0x2, signal: 0xFFFF, random: 0n,
  });
  const fakeDirective = {
    task_type: 'aero-forecast',
    task_type_code: 802,
    domain: 1,
    skill: 'aero-forecast',
    scope: { tools: ['poly_scan'], max_spawn_depth: 3, budget_tokens: 50000 },
    witness_policy: 'parent_required',
    deadline_s: 600,
    pinned_codebook: 'persona-scanner-v1',
  };
  const ts = 1767225600000 + 123456;
  const child = mintAgentUUID({
    parent_agent_uuid: fakeParent,
    directive: fakeDirective,
    spawn_timestamp_ms: ts,
    domain: 1,
    provenance: 0x2,
    spawn_depth: 1,
  });
  const child2 = mintAgentUUID({
    parent_agent_uuid: fakeParent,
    directive: fakeDirective,
    spawn_timestamp_ms: ts,
    domain: 1,
    provenance: 0x2,
    spawn_depth: 1,
  });
  if (child !== child2) throw new Error('mintAgentUUID not deterministic');
  decodeGYST(child); // shape check
  const hb = mintHeartbeatUUID({
    turn_uuid: fakeParent,
    parent_heartbeat_uuid: null,
    event_kind: 'agent_birth',
    event_label: 'birth:aero-forecast',
    branch_depth: 1,
    provenance: 0x2,
    signal: 0xE000,
  });
  decodeGYST(hb);
  const h = hashDirective(fakeDirective);
  if (h.length !== 64) throw new Error('hashDirective bad length');
  console.log('child_agent_uuid:    ', child);
  console.log('birth_heartbeat_uuid:', hb);
  console.log('directive_hash:      ', h);
  console.log('SELFTEST PASS');
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

import { realpathSync } from 'node:fs';
const __self = fileURLToPath(import.meta.url);
let __argv1resolved = '';
try { __argv1resolved = process.argv[1] ? realpathSync(pathResolve(process.argv[1])) : ''; } catch {}
if (process.argv[1] && (__self === __argv1resolved || __self === pathResolve(process.argv[1]) || __self === process.argv[1])) {
  if (process.env.SPAWN_AGENT_SELFTEST === '1' && process.argv.length <= 2) {
    try { selftest(); process.exit(0); }
    catch (e) { console.error('SELFTEST FAIL:', e.message); process.exit(1); }
  } else {
    main().catch(e => {
      console.error('unexpected failure:', e.stack ?? e.message);
      process.exit(1);
    });
  }
}
