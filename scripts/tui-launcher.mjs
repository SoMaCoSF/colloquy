#!/usr/bin/env node
// =============================================================================
// file_id: SOM-SCR-0043-v0.0.3
// name: tui-launcher.mjs
// description: Minimal zero-dep terminal launcher for colloquy agents.
//              Lists available persona codebooks from the local Turso
//              replica, lets the operator pick one, collects the spawn
//              arguments, and invokes the canonical birth ritual via
//              spawn-agent.mjs. Intended for Mini (OMEN-02) but runs
//              anywhere the canonical CLI is present.
// category: SCR
// tags: [colloquy, tui, launcher, hermes, openclaw]
// created: 2026-04-22
// version: 0.0.3
// =============================================================================
//
// Usage:
//   node tui-launcher.mjs                 interactive menu
//   node tui-launcher.mjs --list          non-interactive codebook listing
//   node tui-launcher.mjs --spawn <name>  spawn without menu (uses defaults)
//
// Env required:
//   TURSO_DATABASE_URL
//   TURSO_AUTH_TOKEN    (not required for file://)
//   COLLOQUY_PARENT_AGENT_UUID   default parent for spawns from the TUI
//   COLLOQUY_ROOT_SESSION_UUID   default session pointer
//   COLLOQUY_ROOT_COLLOQUY_UUID  default colloquy pointer
//   COLLOQUY_ROOT_HEARTBEAT_UUID default parent heartbeat pointer
// =============================================================================
import { createRequire } from 'node:module';
import { readFileSync, existsSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir, homedir } from 'node:os';

// ---------- env loader (matches bootstrap-essentials candidate list) ----------
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

// ---------- libsql resolver (matches apply-migration.mjs) ---------------------
const pkgCandidates = [
  `${homedir()}/openclaw/package.json`,
  'D:/somacosf/outputs/somacosf-platform/package.json',
].filter(p => existsSync(p));
if (pkgCandidates.length === 0) { console.error('no @libsql/client package.json found'); process.exit(2); }
const require = createRequire(path.resolve(pkgCandidates[0]));
const { createClient } = require('@libsql/client');

// ---------- spawn-agent.mjs resolver ------------------------------------------
const spawnAgentCandidates = [
  `${homedir()}/openclaw/skills/colloquy/scripts/spawn-agent.mjs`,
  `${homedir()}/.claude/skills/colloquy/scripts/spawn-agent.mjs`,
  'D:/somacosf/.claude/skills/colloquy/scripts/spawn-agent.mjs',
];
const SPAWN_AGENT = spawnAgentCandidates.find(p => existsSync(p));
if (!SPAWN_AGENT) { console.error('spawn-agent.mjs not found; tried:\n  ' + spawnAgentCandidates.join('\n  ')); process.exit(2); }

// ---------- ANSI helpers ------------------------------------------------------
const A = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', magenta: '\x1b[35m',
};
const banner = () => console.log(
  `${A.cyan}${A.bold}╔══════════════════════════════════════════════════════╗\n` +
  `║           SoMaCo Colloquy Agent Launcher             ║\n` +
  `║                    v0.0.3                             ║\n` +
  `╚══════════════════════════════════════════════════════╝${A.reset}`
);

// ---------- DB ----------------------------------------------------------------
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function listCodebooks() {
  const r = await db.execute(`
    SELECT name, domain, generation, witness_policy, shell, sector, face_id
      FROM codebook_personas
     ORDER BY shell, sector, name
  `);
  return r.rows.map(x => ({
    name: String(x.name),
    domain: Number(x.domain),
    generation: Number(x.generation),
    witness_policy: String(x.witness_policy ?? 'parent_required'),
    shell: x.shell != null ? Number(x.shell) : null,
    sector: x.sector != null ? Number(x.sector) : null,
    face_id: x.face_id != null ? Number(x.face_id) : null,
  }));
}

function renderTable(rows) {
  if (rows.length === 0) { console.log(`${A.yellow}no codebook_personas rows — seed first${A.reset}`); return; }
  const header = ['#', 'name', 'dom', 'gen', 'shell', 'sector', 'witness'];
  const w = [3, 36, 4, 4, 6, 7, 20];
  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`${A.bold}${header.map((h, i) => pad(h, w[i])).join(' ')}${A.reset}`);
  console.log(A.dim + w.map(n => '─'.repeat(n)).join(' ') + A.reset);
  rows.forEach((r, i) => {
    const cells = [
      String(i + 1),
      r.name,
      '0x' + r.domain.toString(16),
      String(r.generation),
      r.shell != null ? String(r.shell) : '-',
      r.sector != null ? String(r.sector) : '-',
      r.witness_policy,
    ];
    console.log(cells.map((c, j) => pad(c, w[j])).join(' '));
  });
}

// ---------- prompt helper -----------------------------------------------------
function ask(rl, q, def) {
  return new Promise(res => {
    const suffix = def ? ` ${A.dim}[${def}]${A.reset}` : '';
    rl.question(`${A.cyan}?${A.reset} ${q}${suffix} `, ans => res(ans.trim() || def || ''));
  });
}

// ---------- directive template writer ----------------------------------------
function writeDirective(codebook) {
  const domainHex = '0x' + codebook.domain.toString(16);
  const directive = {
    task_type: `${codebook.name}-task`,
    task_type_code: (codebook.domain << 8) | 0x01,
    domain: codebook.domain,
    skill: codebook.name.replace(/^persona-/, '').replace(/-v\d+$/, ''),
    scope: {
      tools: [],
      max_spawn_depth: 3,
      budget_tokens: 50000,
    },
    witness_policy: codebook.witness_policy,
    deadline_s: 600,
    pinned_codebook: codebook.name,
    notes: `Spawned from TUI launcher at ${new Date().toISOString()} for domain ${domainHex}`,
  };
  const dir = mkdtempSync(path.join(tmpdir(), 'colloquy-directive-'));
  const p = path.join(dir, 'directive.json');
  writeFileSync(p, JSON.stringify(directive, null, 2));
  return p;
}

// ---------- ritual invocation -------------------------------------------------
function invokeRitual({ codebook, dryRun }) {
  const directivePath = writeDirective(codebook);
  const args = [
    SPAWN_AGENT,
    '--parent-agent-uuid', process.env.COLLOQUY_PARENT_AGENT_UUID ?? '',
    '--parent-session-uuid', process.env.COLLOQUY_ROOT_SESSION_UUID ?? '',
    '--colloquy-uuid', process.env.COLLOQUY_ROOT_COLLOQUY_UUID ?? '',
    '--parent-heartbeat-uuid', process.env.COLLOQUY_ROOT_HEARTBEAT_UUID ?? '',
    '--directive-json-path', directivePath,
    '--codebook-name', codebook.name,
    '--codebook-generation', String(codebook.generation),
    '--witness-policy', codebook.witness_policy,
    '--sandbox-tier', '3',
  ];
  if (dryRun) args.push('--dry-run');
  const missing = ['COLLOQUY_PARENT_AGENT_UUID', 'COLLOQUY_ROOT_SESSION_UUID',
                   'COLLOQUY_ROOT_COLLOQUY_UUID', 'COLLOQUY_ROOT_HEARTBEAT_UUID']
    .filter(k => !process.env[k]);
  if (missing.length && !dryRun) {
    console.log(`${A.red}missing env for real spawn:${A.reset} ${missing.join(', ')}`);
    console.log(`${A.yellow}falling back to --dry-run${A.reset}`);
    args.push('--dry-run');
  }

  console.log(`${A.magenta}→ node ${path.basename(SPAWN_AGENT)} ${args.slice(1).join(' ')}${A.reset}`);
  const r = spawnSync('node', args, { stdio: 'inherit', env: process.env });
  return r.status ?? 1;
}

// ---------- main --------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) {
    renderTable(await listCodebooks());
    process.exit(0);
  }

  banner();
  const codebooks = await listCodebooks();
  renderTable(codebooks);
  console.log();

  if (argv.includes('--spawn')) {
    const name = argv[argv.indexOf('--spawn') + 1];
    const cb = codebooks.find(c => c.name === name);
    if (!cb) { console.log(`${A.red}no codebook named ${name}${A.reset}`); process.exit(2); }
    process.exit(invokeRitual({ codebook: cb, dryRun: argv.includes('--dry-run') }));
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const choice = await ask(rl, 'Pick # (or name, or "q" to quit):');
    if (!choice || choice === 'q') return;
    const cb = /^\d+$/.test(choice)
      ? codebooks[Number(choice) - 1]
      : codebooks.find(c => c.name === choice);
    if (!cb) { console.log(`${A.red}no such codebook${A.reset}`); return; }

    const mode = await ask(rl, `Spawn with ${A.bold}${cb.name}${A.reset} — mode? (real/dry)`, 'dry');
    const status = invokeRitual({ codebook: cb, dryRun: mode === 'dry' });
    if (status === 0) console.log(`${A.green}✓ ritual complete${A.reset}`);
    else console.log(`${A.red}✗ ritual exit=${status}${A.reset}`);
  } finally { rl.close(); }
}

main().catch(e => { console.error(`${A.red}fatal:${A.reset} ${e.stack ?? e.message}`); process.exit(1); });
