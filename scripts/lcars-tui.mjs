#!/usr/bin/env node
// =============================================================================
// file_id: SOM-SCR-0047-v0.0.1
// name: lcars-tui.mjs
// description: LCARS-themed mission control TUI. Parallel to mission-control-
//              tui.mjs (the plain fallback); this one renders the Voxel/Vertex/
//              Openclaw roster in Star-Trek LCARS visual language — elbows,
//              pill-bars, salmon/butterscotch/lavender palette, uppercase,
//              numeric section codes. Schema-adaptive (handles Mini's missing
//              `host` column). Zero deps. Requires a 24-bit-color terminal.
// category: SCR
// tags: [colloquy, tui, lcars, somaco-brand, mission-control]
// created: 2026-04-22
// version: 0.0.1
// =============================================================================
//
// Usage:
//   node lcars-tui.mjs             # interactive LCARS dashboard
//   node lcars-tui.mjs --list      # non-interactive roster dump
//   node lcars-tui.mjs --ping <uuid-short>
//
// Ref: http://www.lcars.org.uk/  ·  MichalSvatos/pi-hole-star-trek-picard
// =============================================================================
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';
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

// ---------- libsql ------------------------------------------------------------
const pkgCandidates = [
  `${homedir()}/openclaw/package.json`,
  'D:/somacosf/outputs/somacosf-platform/package.json',
].filter(p => existsSync(p));
if (pkgCandidates.length === 0) { console.error('no @libsql/client package.json'); process.exit(2); }
const require = createRequire(path.resolve(pkgCandidates[0]));
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// ---------- script resolvers --------------------------------------------------
function resolveScript(name) {
  return [
    `${homedir()}/openclaw/skills/colloquy/scripts/${name}`,
    `${homedir()}/.claude/skills/colloquy/scripts/${name}`,
    `D:/somacosf/.claude/skills/colloquy/scripts/${name}`,
  ].find(p => existsSync(p));
}
const SPAWN_AGENT = resolveScript('spawn-agent.mjs');

function discoverLaunchers() {
  const cands = {
    voxel:  [`${homedir()}/.local/bin/voxel`,  `${homedir()}/openclaw/scripts/voxel-launch.sh`, `${homedir()}/openclaw/scripts/hermes-launch.sh`],
    vertex: [`${homedir()}/.local/bin/vertex`, `${homedir()}/openclaw/scripts/vertex-launch.sh`, `${homedir()}/vertex/server.py`, 'D:/somacosf/vertex/server.py'],
  };
  const out = {};
  for (const [k, list] of Object.entries(cands)) out[k] = list.find(p => existsSync(p)) ?? null;
  return out;
}

// ---------- LCARS palette (24-bit) --------------------------------------------
// Classic TNG + Picard-era blend. All picked to remain legible on black.
const LCARS = {
  salmon:      [0xFF, 0x99, 0x66],  // elbow primary
  butterscotch:[0xFF, 0xCC, 0x66],  // secondary bar
  tan:         [0xFF, 0xCC, 0x99],  // cell fill
  lavender:    [0xCC, 0x99, 0xCC],  // memory / vertex accent
  sky:         [0x99, 0xCC, 0xFF],  // comms / voxel accent
  orange:      [0xFF, 0x99, 0x00],  // active status
  steel:       [0x66, 0x88, 0xCC],  // openclaw / daemon accent
  red_alert:   [0xCC, 0x33, 0x33],  // error
  green_go:    [0x33, 0xCC, 0x66],  // ok
  peach:       [0xFF, 0xAA, 0x77],
  tan_dim:     [0x99, 0x77, 0x66],
  ink:         [0x11, 0x11, 0x11],
  bone:        [0xEE, 0xDD, 0xCC],
};
const RS = '\x1b[0m';
const B  = '\x1b[1m';
const fg = ([r,g,b]) => `\x1b[38;2;${r};${g};${b}m`;
const bg = ([r,g,b]) => `\x1b[48;2;${r};${g};${b}m`;

// ---------- LCARS helpers -----------------------------------------------------
// Star Trek stardate: [year-2300].[fractional-day]. Matches the feel, not TOS canon.
// TNG-style stardate: [YY since 2000].[DoY.fraction*10]. Readable and positive.
function stardate() {
  const n = new Date();
  const yr = (n.getFullYear() - 2000).toString().padStart(2, '0');
  const start = new Date(n.getFullYear(), 0, 1).getTime();
  const doy = (n.getTime() - start) / 86400000;
  return `${yr}${(doy * 10).toFixed(1).padStart(6, '0')}`;
}

function hostname() {
  try { return require('node:os').hostname(); } catch { return 'local'; }
}

// LCARS pill: rounded caps on left/right using Unicode half-blocks.
function pill(text, color, textColor = LCARS.ink) {
  return `${fg(color)}${bg(color)} ${fg(textColor)}${bg(color)}${B}${text.toUpperCase()}${RS}${fg(color)}${bg(color)} ${RS}`;
}

// Numeric section code. LCARS uses arbitrary-looking numeric tags.
function code(n, digits = 4) { return String(n).padStart(digits, '0'); }

// Elbow corner — upper-left "L" shape that is the canonical LCARS silhouette.
//
//   ▗▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
//   ▐
//   ▐
//
function drawHeader(termWidth, title = 'MISSION CONTROL · SOMACO LOCAL NODE') {
  const bar = '▄'.repeat(Math.max(termWidth - 28, 24));
  const sd = stardate();
  const sal = fg(LCARS.salmon);
  const but = fg(LCARS.butterscotch);
  const tan = fg(LCARS.tan);
  console.log(`${sal}╭──────╮${but} ${bar}${RS}`);
  console.log(
    `${sal}│${bg(LCARS.salmon)}${fg(LCARS.ink)}${B} ${code(2531,4)} ${RS}${sal}│${RS}  ` +
    `${but}${B}${title}${RS}  ${tan}SD ${sd}  HOST ${hostname()}${RS}`
  );
  console.log(`${sal}╰──────╯${RS}`);
}

function drawFooter() {
  const p = fg(LCARS.salmon);
  const b = fg(LCARS.butterscotch);
  console.log();
  console.log(
    `${p}▐${RS} ` +
    pill(`${code(471,3)} CHAT`,      LCARS.butterscotch) +
    pill(`${code(202,3)} PING`,      LCARS.sky) +
    pill(`${code(314,3)} SPAWN`,     LCARS.lavender) +
    pill(`${code(808,3)} HEARTBEAT`, LCARS.tan) +
    pill(`${code(0,3)} EXIT`,        LCARS.red_alert, LCARS.bone) +
    ` ${p}▌${RS}`
  );
  console.log(`${b}${'─'.repeat(60)}${RS}`);
}

// ---------- DB loaders --------------------------------------------------------
const ROOT_CODEBOOKS = ['persona-voxel-v1', 'persona-hermes-v1', 'persona-vertex-v1', 'persona-openclaw-v1'];

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
  const topRows = (await db.execute({
    sql: `SELECT a.agent_uuid, a.parent_agent_uuid, a.spawn_depth, a.sandbox_tier,
                 a.sandbox_vm_id, a.sandbox_booted_at AS booted_at,
                 ${hostExpr} AS host,
                 cp.name AS codebook_name, cp.domain, cp.witness_policy
            FROM agents a
            JOIN codebook_personas cp ON cp.codebook_uuid = a.codebook_uuid
           WHERE cp.name IN (${ROOT_CODEBOOKS.map(() => '?').join(',')})
           ORDER BY cp.name${hostOrder}`,
    args: ROOT_CODEBOOKS,
  })).rows;
  const parentUuids = topRows.map(r => String(r.agent_uuid));
  let children = [];
  if (parentUuids.length > 0) {
    const r = await db.execute({
      sql: `SELECT a.agent_uuid, a.parent_agent_uuid, a.spawn_depth, ${hostExpr} AS host,
                   cp.name AS codebook_name, cp.domain
              FROM agents a
              JOIN codebook_personas cp ON cp.codebook_uuid = a.codebook_uuid
             WHERE a.parent_agent_uuid IN (${parentUuids.map(() => '?').join(',')})
             ORDER BY a.parent_agent_uuid, a.spawn_depth`,
      args: parentUuids,
    });
    children = r.rows;
  }
  return { topRows, children };
}

const short = u => String(u).slice(0, 8);

function cbColor(name) {
  const n = String(name).toLowerCase();
  if (n.includes('voxel') || n.includes('hermes'))   return LCARS.sky;
  if (n.includes('vertex'))                          return LCARS.lavender;
  if (n.includes('openclaw'))                        return LCARS.steel;
  if (n.includes('vector'))                          return LCARS.peach;
  return LCARS.tan;
}

function renderRoster({ topRows, children }) {
  if (topRows.length === 0) {
    console.log(`${fg(LCARS.red_alert)}${B}NO ROSTER ROWS — SEED PERSONAS + BIRTH ROOTS${RS}`);
    return [];
  }
  const flat = [];
  let idx = 0;
  const sal = fg(LCARS.salmon);
  const bone = fg(LCARS.bone);
  const dim = fg(LCARS.tan_dim);

  console.log(`${sal}▐${RS} ${pill(`${code(80,3)}-AGENTS`, LCARS.butterscotch)} ${dim}${topRows.length + children.length} TOTAL${RS}`);
  console.log();

  for (const r of topRows) {
    idx += 1;
    const cb = String(r.codebook_name);
    const color = cbColor(cb);
    const num = `${B}${fg(LCARS.salmon)}${String(idx).padStart(2, '0')}${RS}`;
    const uuid = `${dim}${short(r.agent_uuid)}${RS}`;
    const host = `${bone}HOST ${String(r.host ?? '?').padEnd(10)}${RS}`;
    const tier = `${bone}TIER ${String(r.sandbox_tier ?? '-')}${RS}`;
    const vm   = `${dim}VM ${String(r.sandbox_vm_id ?? '-').slice(0, 8)}${RS}`;
    console.log(`  ${num} ${pill(cb.replace('persona-', '').replace('-v1', ''), color)} ${uuid}  ${host} ${tier} ${vm}`);
    flat.push({ ...r, idx });

    const kids = children.filter(k => String(k.parent_agent_uuid) === String(r.agent_uuid));
    for (const k of kids) {
      idx += 1;
      const kc = cbColor(k.codebook_name);
      const knum = `${dim}${String(idx).padStart(2, '0')}${RS}`;
      console.log(
        `     ${fg(LCARS.salmon)}╰▶${RS} ${knum} ${pill(String(k.codebook_name).replace('persona-', '').replace('-v1', ''), kc)} ` +
        `${dim}${short(k.agent_uuid)}  DEPTH ${k.spawn_depth}${RS}`
      );
      flat.push({ ...k, idx });
    }
  }
  return flat;
}

async function tailHeartbeats(agent_uuid, limit = 10) {
  const r = await db.execute({
    sql: `SELECT heartbeat_uuid, event_kind, created_at, payload_json
            FROM heartbeats WHERE agent_uuid = ?
           ORDER BY created_at DESC LIMIT ?`,
    args: [agent_uuid, limit],
  });
  const sal = fg(LCARS.salmon), but = fg(LCARS.butterscotch), dim = fg(LCARS.tan_dim);
  console.log();
  console.log(`${sal}▐${RS} ${pill(`${code(808,3)}-HEARTBEATS`, LCARS.tan)} ${dim}${short(agent_uuid)}${RS}`);
  if (r.rows.length === 0) {
    console.log(`  ${fg(LCARS.red_alert)}NO HEARTBEATS${RS}`);
    return;
  }
  for (const hb of r.rows.reverse()) {
    console.log(`  ${dim}${hb.created_at}${RS}  ${but}${B}${String(hb.event_kind).toUpperCase().padEnd(18)}${RS}  ${dim}${short(hb.heartbeat_uuid)}${RS}`);
  }
}

function openChat(codebookName) {
  const launchers = discoverLaunchers();
  let cmd = null, args = [];
  const n = codebookName.toLowerCase();
  if (n.includes('voxel') || n.includes('hermes')) { cmd = launchers.voxel; args = ['chat']; }
  else if (n.includes('vertex')) { cmd = launchers.vertex; if (cmd && cmd.endsWith('.py')) { args = [cmd]; cmd = 'python3'; } }
  else if (n.includes('openclaw')) { console.log(`${fg(LCARS.butterscotch)}OPENCLAW IS A DAEMON · curl http://localhost:7374/health${RS}`); return; }
  if (!cmd) { console.log(`${fg(LCARS.red_alert)}NO LAUNCHER FOR ${codebookName}${RS}`); return; }
  console.log(`${fg(LCARS.sky)}▶ ${cmd} ${args.join(' ')}${RS}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: process.env });
  if (r.status !== 0) console.log(`${fg(LCARS.red_alert)}EXIT=${r.status}${RS}`);
}

async function spawnChild(parent, codebookName) {
  if (!SPAWN_AGENT) { console.log(`${fg(LCARS.red_alert)}spawn-agent.mjs NOT FOUND${RS}`); return; }
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(path.join(tmpdir(), 'lcars-directive-'));
  const directive = {
    task_type: `${codebookName}-subtask`, task_type_code: 0x0301,
    domain: Number(parent.domain ?? 6), skill: codebookName,
    scope: { tools: [], max_spawn_depth: 2, budget_tokens: 10000 },
    witness_policy: 'parent_required', deadline_s: 600,
    pinned_codebook: codebookName,
    notes: `Spawned from LCARS TUI under ${short(parent.agent_uuid)}`,
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
    '--codebook-name', codebookName, '--codebook-generation', '1',
    '--witness-policy', 'parent_required', '--sandbox-tier', '3',
  ];
  console.log(`${fg(LCARS.lavender)}▶ node spawn-agent.mjs … --codebook-name ${codebookName}${RS}`);
  const r = spawnSync('node', args, { stdio: 'inherit', env: process.env });
  console.log(r.status === 0 ? `${fg(LCARS.green_go)}✓ CHILD SPAWNED${RS}` : `${fg(LCARS.red_alert)}✗ SPAWN FAILED exit=${r.status}${RS}`);
}

function ask(rl, q, def) {
  return new Promise(res => {
    const suffix = def ? ` ${fg(LCARS.tan_dim)}[${def}]${RS}` : '';
    rl.question(`${fg(LCARS.salmon)}▶${RS} ${fg(LCARS.butterscotch)}${q.toUpperCase()}${RS}${suffix} `, a => res(a.trim() || def || ''));
  });
}

// ---------- main --------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  const termWidth = process.stdout.columns || 100;
  const { topRows, children } = await loadRoster();

  if (argv.includes('--list')) {
    drawHeader(termWidth);
    renderRoster({ topRows, children });
    drawFooter();
    process.exit(0);
  }
  if (argv.includes('--ping')) {
    const s = argv[argv.indexOf('--ping') + 1];
    const flat = [...topRows, ...children];
    const match = flat.find(r => short(r.agent_uuid) === s || String(r.agent_uuid) === s);
    if (!match) { console.log(`${fg(LCARS.red_alert)}NO AGENT ${s}${RS}`); process.exit(2); }
    await tailHeartbeats(String(match.agent_uuid), 20);
    process.exit(0);
  }

  drawHeader(termWidth);
  const flat = renderRoster({ topRows, children });
  drawFooter();
  if (flat.length === 0) process.exit(0);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const pick = await ask(rl, 'Select row # / Q to exit');
      if (!pick || pick.toLowerCase() === 'q') break;
      const row = flat.find(r => String(r.idx) === pick);
      if (!row) { console.log(`${fg(LCARS.red_alert)}NO SUCH ROW${RS}`); continue; }
      const cb = String(row.codebook_name);
      console.log();
      console.log(`${fg(LCARS.salmon)}▐${RS} ${pill(cb.replace('persona-', '').replace('-v1', ''), cbColor(cb))} ${fg(LCARS.tan_dim)}${short(row.agent_uuid)}${RS}`);
      const action = await ask(rl, '[C]hat [P]ing [S]pawn [H]eartbeats [B]ack', 'p');
      const a = action.toLowerCase();
      if (a === 'c') openChat(cb);
      else if (a === 'p' || a === 'h') await tailHeartbeats(String(row.agent_uuid), 15);
      else if (a === 's') {
        const cbChild = await ask(rl, 'Child codebook name', cb);
        if (cbChild) await spawnChild(row, cbChild);
      }
      console.log();
    }
  } finally { rl.close(); }
}

main().catch(e => { console.error(`${fg(LCARS.red_alert)}FATAL:${RS} ${e.stack ?? e.message}`); process.exit(1); });
