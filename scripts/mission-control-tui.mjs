#!/usr/bin/env node
// =============================================================================
// file_id: SOM-SCR-0044-v0.0.1
// name: mission-control-tui.mjs
// description: Unified terminal launcher for the local-node agent roster.
//              Lists Voxel (courier), Vertex (memory), Openclaw (daemon root),
//              and any sub-agents they've spawned. Lets the operator: ping,
//              open chat, spawn a child, or tail heartbeats — all against the
//              local Turso replica + canonical spawn-agent.mjs. Zero deps.
// category: SCR
// tags: [colloquy, tui, mission-control, voxel, vertex, openclaw]
// created: 2026-04-22
// version: 0.0.1
// =============================================================================
//
// Usage:
//   node mission-control-tui.mjs              interactive menu
//   node mission-control-tui.mjs --list       non-interactive roster dump
//   node mission-control-tui.mjs --ping <uuid-short>
//
// Env (same as tui-launcher.mjs):
//   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
//   COLLOQUY_PARENT_AGENT_UUID, COLLOQUY_ROOT_SESSION_UUID,
//   COLLOQUY_ROOT_COLLOQUY_UUID, COLLOQUY_ROOT_HEARTBEAT_UUID
// =============================================================================
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { homedir } from 'node:os';

// ---------- env loader --------------------------------------------------------
const envCandidates = [
  process.env.APPLY_MIGRATION_ENV_FILE,
  `${homedir()}/.openclaw.env`,
  'D:/somacosf/outputs/somacosf-platform/.env.local',
].filter(Boolean);
for (const f of envCandidates) if (f && existsSync(f)) {
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  break;
}

// ---------- libsql resolver ---------------------------------------------------
const pkgCandidates = [
  `${homedir()}/openclaw/package.json`,
  'D:/somacosf/outputs/somacosf-platform/package.json',
].filter(p => existsSync(p));
if (pkgCandidates.length === 0) { console.error('no @libsql/client package.json found'); process.exit(2); }
const require = createRequire(path.resolve(pkgCandidates[0]));
const { createClient } = require('@libsql/client');

// ---------- canonical script resolver -----------------------------------------
function resolveScript(name) {
  const candidates = [
    `${homedir()}/openclaw/skills/colloquy/scripts/${name}`,
    `${homedir()}/.claude/skills/colloquy/scripts/${name}`,
    `D:/somacosf/.claude/skills/colloquy/scripts/${name}`,
  ];
  return candidates.find(p => existsSync(p));
}
const SPAWN_AGENT = resolveScript('spawn-agent.mjs');

// ---------- launcher discovery (for Voxel/Vertex CLIs) ------------------------
function discoverLaunchers() {
  const cands = {
    voxel: [
      `${homedir()}/.local/bin/voxel`,                   // canonical alias wrapper
      `${homedir()}/openclaw/scripts/voxel-launch.sh`,
      `${homedir()}/openclaw/scripts/hermes-launch.sh`,  // legacy
    ],
    vertex: [
      `${homedir()}/.local/bin/vertex`,                  // canonical alias wrapper
      `${homedir()}/openclaw/scripts/vertex-launch.sh`,
      `${homedir()}/vertex/server.py`,
      'D:/somacosf/vertex/server.py',
    ],
  };
  const found = {};
  for (const [name, list] of Object.entries(cands)) {
    found[name] = list.find(p => existsSync(p)) ?? null;
  }
  return found;
}

// ---------- ANSI --------------------------------------------------------------
const A = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
  red: '\x1b[31m', magenta: '\x1b[35m', blue: '\x1b[34m',
};
const banner = () => console.log(
  `${A.cyan}${A.bold}╔══════════════════════════════════════════════════════╗\n` +
  `║        SoMaCo Mission Control — Local Roster         ║\n` +
  `║             Voxel · Vertex · Openclaw                 ║\n` +
  `╚══════════════════════════════════════════════════════╝${A.reset}`
);

// ---------- DB ----------------------------------------------------------------
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const ROOT_CODEBOOKS = ['persona-voxel-v1', 'persona-hermes-v1', 'persona-vertex-v1', 'persona-openclaw-v1'];

// Detect whether `agents.host` column exists (canonical schema) or not (Mini).
async function hasHostColumn() {
  try {
    const r = await db.execute(`PRAGMA table_info(agents)`);
    return r.rows.some(x => String(x.name) === 'host');
  } catch { return false; }
}

async function loadRoster() {
  const hostCol = await hasHostColumn();
  const hostExpr = hostCol ? 'a.host' : `'?'`;
  const hostOrder = hostCol ? ', a.host' : '';

  // Top-level: agents whose codebook is one of the named personas.
  const topRows = (await db.execute({
    sql: `
      SELECT a.agent_uuid, a.parent_agent_uuid, a.spawn_depth, a.sandbox_tier,
             a.sandbox_vm_id, a.sandbox_booted_at AS booted_at,
             ${hostExpr} AS host,
             cp.name AS codebook_name, cp.domain, cp.witness_policy
        FROM agents a
        JOIN codebook_personas cp ON cp.codebook_uuid = a.codebook_uuid
       WHERE cp.name IN (${ROOT_CODEBOOKS.map(() => '?').join(',')})
       ORDER BY cp.name${hostOrder}
    `,
    args: ROOT_CODEBOOKS,
  })).rows;

  // Children: anything whose parent is one of those roots.
  const parentUuids = topRows.map(r => String(r.agent_uuid));
  let children = [];
  if (parentUuids.length > 0) {
    const r = await db.execute({
      sql: `
        SELECT a.agent_uuid, a.parent_agent_uuid, a.spawn_depth, ${hostExpr} AS host,
               cp.name AS codebook_name, cp.domain
          FROM agents a
          JOIN codebook_personas cp ON cp.codebook_uuid = a.codebook_uuid
         WHERE a.parent_agent_uuid IN (${parentUuids.map(() => '?').join(',')})
         ORDER BY a.parent_agent_uuid, a.spawn_depth
      `,
      args: parentUuids,
    });
    children = r.rows;
  }

  return { topRows, children };
}

function short(uuid) { return String(uuid).slice(0, 8); }

function renderRoster({ topRows, children }) {
  if (topRows.length === 0) {
    console.log(`${A.yellow}no roster rows — seed personas + birth Openclaw/Voxel/Vertex first${A.reset}`);
    return [];
  }
  const flat = [];
  let idx = 0;
  for (const r of topRows) {
    idx += 1;
    const cb = String(r.codebook_name);
    const color = cb.includes('voxel') || cb.includes('hermes') ? A.magenta
                : cb.includes('vertex') ? A.blue
                : cb.includes('openclaw') ? A.green : A.cyan;
    console.log(
      `${A.bold}${String(idx).padStart(2)}${A.reset}  ${color}${cb.padEnd(24)}${A.reset} ` +
      `${A.dim}${short(r.agent_uuid)}${A.reset}  host=${r.host ?? '?'}  ` +
      `tier=${r.sandbox_tier ?? '-'}  vm=${r.sandbox_vm_id ?? '-'}`
    );
    flat.push({ ...r, idx });
    const kids = children.filter(k => String(k.parent_agent_uuid) === String(r.agent_uuid));
    for (const k of kids) {
      idx += 1;
      console.log(
        `    ${A.dim}└─ ${String(idx).padStart(2)} ${String(k.codebook_name).padEnd(22)} ` +
        `${short(k.agent_uuid)}  depth=${k.spawn_depth}${A.reset}`
      );
      flat.push({ ...k, idx });
    }
  }
  return flat;
}

async function tailHeartbeats(agent_uuid, limit = 10) {
  const r = await db.execute({
    sql: `
      SELECT heartbeat_uuid, event_kind, created_at, payload_json
        FROM heartbeats
       WHERE agent_uuid = ?
       ORDER BY created_at DESC
       LIMIT ?
    `,
    args: [agent_uuid, limit],
  });
  if (r.rows.length === 0) { console.log(`${A.yellow}no heartbeats for ${short(agent_uuid)}${A.reset}`); return; }
  for (const hb of r.rows.reverse()) {
    console.log(`${A.dim}${hb.created_at}${A.reset}  ${A.bold}${hb.event_kind}${A.reset}  ${short(hb.heartbeat_uuid)}`);
  }
}

function openChat(codebookName) {
  const launchers = discoverLaunchers();
  let cmd = null, args = [];
  if (codebookName.includes('voxel') || codebookName.includes('hermes')) {
    cmd = launchers.voxel;
    args = ['chat'];
  } else if (codebookName.includes('vertex')) {
    cmd = launchers.vertex;
    if (cmd && cmd.endsWith('.py')) args = [cmd], cmd = 'python3';
  } else if (codebookName.includes('openclaw')) {
    // Openclaw has no chat; open health endpoint instead
    console.log(`${A.yellow}openclaw is a daemon; curl http://localhost:7374/health${A.reset}`);
    return;
  }
  if (!cmd) { console.log(`${A.red}no launcher found for ${codebookName}${A.reset}`); return; }
  console.log(`${A.magenta}→ ${cmd} ${args.join(' ')}${A.reset}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: process.env });
  if (r.status !== 0) console.log(`${A.red}exit=${r.status}${A.reset}`);
}

async function spawnChild(parent, codebookName) {
  if (!SPAWN_AGENT) { console.log(`${A.red}spawn-agent.mjs not found${A.reset}`); return; }
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(path.join(tmpdir(), 'mc-directive-'));
  const directive = {
    task_type: `${codebookName}-subtask`,
    task_type_code: 0x0301,
    domain: Number(parent.domain ?? 6),
    skill: codebookName,
    scope: { tools: [], max_spawn_depth: 2, budget_tokens: 10000 },
    witness_policy: 'parent_required',
    deadline_s: 600,
    pinned_codebook: codebookName,
    notes: `Spawned from Mission Control TUI under ${short(parent.agent_uuid)}`,
  };
  const p = path.join(dir, 'directive.json');
  writeFileSync(p, JSON.stringify(directive, null, 2));
  const args = [
    SPAWN_AGENT,
    '--parent-agent-uuid', String(parent.agent_uuid),
    '--parent-session-uuid', process.env.COLLOQUY_ROOT_SESSION_UUID ?? '',
    '--colloquy-uuid', process.env.COLLOQUY_ROOT_COLLOQUY_UUID ?? '',
    '--parent-heartbeat-uuid', process.env.COLLOQUY_ROOT_HEARTBEAT_UUID ?? '',
    '--directive-json-path', p,
    '--codebook-name', codebookName,
    '--codebook-generation', '1',
    '--witness-policy', 'parent_required',
    '--sandbox-tier', '3',
  ];
  console.log(`${A.magenta}→ node spawn-agent.mjs … --codebook-name ${codebookName}${A.reset}`);
  const r = spawnSync('node', args, { stdio: 'inherit', env: process.env });
  if (r.status === 0) console.log(`${A.green}✓ child spawned${A.reset}`);
  else console.log(`${A.red}✗ spawn failed (exit=${r.status})${A.reset}`);
}

function ask(rl, q, def) {
  return new Promise(res => {
    const suffix = def ? ` ${A.dim}[${def}]${A.reset}` : '';
    rl.question(`${A.cyan}?${A.reset} ${q}${suffix} `, ans => res(ans.trim() || def || ''));
  });
}

// ---------- main --------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  const { topRows, children } = await loadRoster();

  if (argv.includes('--list')) {
    renderRoster({ topRows, children });
    process.exit(0);
  }
  if (argv.includes('--ping')) {
    const s = argv[argv.indexOf('--ping') + 1];
    const flat = [...topRows, ...children];
    const match = flat.find(r => short(r.agent_uuid) === s || String(r.agent_uuid) === s);
    if (!match) { console.log(`${A.red}no agent matching ${s}${A.reset}`); process.exit(2); }
    await tailHeartbeats(String(match.agent_uuid), 20);
    process.exit(0);
  }

  banner();
  const flat = renderRoster({ topRows, children });
  if (flat.length === 0) process.exit(0);
  console.log();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const pick = await ask(rl, 'Pick # (or "q"):');
      if (!pick || pick === 'q') break;
      const row = flat.find(r => String(r.idx) === pick);
      if (!row) { console.log(`${A.red}no such row${A.reset}`); continue; }
      const cb = String(row.codebook_name);
      console.log(`\n${A.bold}${cb}${A.reset} ${A.dim}${short(row.agent_uuid)}${A.reset}`);
      const action = await ask(rl,
        'Action? [c]hat / [p]ing / [s]pawn-child / [h]eartbeats / [b]ack',
        'p'
      );
      if (action === 'c') openChat(cb);
      else if (action === 'p' || action === 'h') await tailHeartbeats(String(row.agent_uuid), 15);
      else if (action === 's') {
        const cbChild = await ask(rl, 'Child codebook name:', cb);
        if (cbChild) await spawnChild(row, cbChild);
      }
      console.log();
    }
  } finally { rl.close(); }
}

main().catch(e => { console.error(`${A.red}fatal:${A.reset} ${e.stack ?? e.message}`); process.exit(1); });
